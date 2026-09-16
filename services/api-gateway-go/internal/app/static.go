package app

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func GatewayNotFoundHandler(frontend fs.FS, aiCoreURL string) http.Handler {
	frontendHandler := CompressionHandler(FrontendHandler(frontend))
	aiProxy := AIProxyHandler(aiCoreURL)

	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/ai/") {
			aiProxy.ServeHTTP(response, request)
			return
		}
		frontendHandler.ServeHTTP(response, request)
	})
}

func AIProxyHandler(aiCoreURL string) http.Handler {
	target, err := url.Parse(strings.TrimRight(aiCoreURL, "/"))
	if err != nil {
		return http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
			writeJSON(response, http.StatusBadGateway, map[string]string{
				"error": "invalid_ai_core_url",
			})
		})
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(response http.ResponseWriter, _ *http.Request, _ error) {
		writeJSON(response, http.StatusBadGateway, map[string]string{
			"error": "ai_core_unavailable",
		})
	}
	return proxy
}

func FrontendHandler(frontend fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(frontend))

	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if strings.HasPrefix(request.URL.Path, "/api/") || strings.HasPrefix(request.URL.Path, "/ai/") {
			http.NotFound(response, request)
			return
		}

		path := strings.TrimPrefix(request.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		if _, err := fs.Stat(frontend, path); err == nil {
			fileServer.ServeHTTP(response, request)
			return
		}

		index, err := frontend.Open("index.html")
		if err != nil {
			http.NotFound(response, request)
			return
		}
		defer index.Close()

		response.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.Copy(response, index)
	})
}
