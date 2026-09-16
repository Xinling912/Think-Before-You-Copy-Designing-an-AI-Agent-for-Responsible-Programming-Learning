package app

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestFrontendHandlerServesIndex(t *testing.T) {
	handler := FrontendHandler(testFrontendFS())
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/", nil)

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `<div id="root"></div>`) {
		t.Fatalf("expected frontend index, got %s", response.Body.String())
	}
}

func TestFrontendHandlerFallsBackForClientRoutes(t *testing.T) {
	handler := FrontendHandler(testFrontendFS())
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/dashboard", nil)

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), `<div id="root"></div>`) {
		t.Fatalf("expected client route fallback, got %s", response.Body.String())
	}
}

func TestFrontendHandlerDoesNotHandleAPIRoutes(t *testing.T) {
	handler := FrontendHandler(testFrontendFS())
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/missing", nil)

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected API route 404, got %d", response.Code)
	}
}

func TestGatewayNotFoundHandlerProxiesAIRoutes(t *testing.T) {
	aiCore := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/ai/health" {
			t.Fatalf("expected /ai/health, got %s", request.URL.Path)
		}
		writeJSON(response, http.StatusOK, map[string]string{
			"service": "ai-core-python",
			"status":  "ok",
		})
	}))
	defer aiCore.Close()

	handler := GatewayNotFoundHandler(testFrontendFS(), aiCore.URL)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/ai/health", nil)

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", response.Code)
	}
	if !strings.Contains(response.Body.String(), "ai-core-python") {
		t.Fatalf("expected AI Core response, got %s", response.Body.String())
	}
}

func testFrontendFS() fs.FS {
	return fstest.MapFS{
		"index.html": {
			Data: []byte(`<!doctype html><html><body><div id="root"></div></body></html>`),
		},
		"umi.js": {
			Data: []byte(`console.log("frontend");`),
		},
	}
}
