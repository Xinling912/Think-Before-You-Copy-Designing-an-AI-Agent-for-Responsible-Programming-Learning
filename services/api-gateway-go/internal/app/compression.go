package app

import (
	"compress/gzip"
	"net/http"
	"strings"
)

// CompressionHandler applies gzip only to ordinary gateway responses.
func CompressionHandler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if !shouldCompressRequest(request) {
			next.ServeHTTP(response, request)
			return
		}

		writer := &gzipResponseWriter{ResponseWriter: response}
		next.ServeHTTP(writer, request)
		_ = writer.Close()
	})
}

func shouldCompressRequest(request *http.Request) bool {
	if request.URL.Path == "/api/session/message/stream" || strings.HasPrefix(request.URL.Path, "/ai/") {
		return false
	}
	return acceptsGzip(request.Header.Get("Accept-Encoding"))
}

func acceptsGzip(value string) bool {
	for _, entry := range strings.Split(value, ",") {
		parts := strings.Split(entry, ";")
		if !strings.EqualFold(strings.TrimSpace(parts[0]), "gzip") {
			continue
		}
		for _, parameter := range parts[1:] {
			if strings.EqualFold(strings.TrimSpace(parameter), "q=0") || strings.EqualFold(strings.TrimSpace(parameter), "q=0.0") {
				return false
			}
		}
		return true
	}
	return false
}

type gzipResponseWriter struct {
	http.ResponseWriter
	writer      *gzip.Writer
	wroteHeader bool
}

func (writer *gzipResponseWriter) WriteHeader(status int) {
	if writer.wroteHeader {
		return
	}
	writer.wroteHeader = true
	if statusAllowsBody(status) {
		writer.Header().Del("Content-Length")
		writer.Header().Set("Content-Encoding", "gzip")
		addVaryHeader(writer.Header(), "Accept-Encoding")
		writer.ResponseWriter.WriteHeader(status)
		writer.writer = gzip.NewWriter(writer.ResponseWriter)
		return
	}
	writer.ResponseWriter.WriteHeader(status)
}

func (writer *gzipResponseWriter) Write(body []byte) (int, error) {
	if !writer.wroteHeader {
		writer.WriteHeader(http.StatusOK)
	}
	if writer.writer == nil {
		return writer.ResponseWriter.Write(body)
	}
	return writer.writer.Write(body)
}

func (writer *gzipResponseWriter) Close() error {
	if writer.writer == nil {
		return nil
	}
	return writer.writer.Close()
}

func statusAllowsBody(status int) bool {
	return status >= http.StatusOK && status != http.StatusNoContent && status != http.StatusNotModified
}

func addVaryHeader(header http.Header, value string) {
	for _, existing := range header.Values("Vary") {
		for _, item := range strings.Split(existing, ",") {
			if strings.EqualFold(strings.TrimSpace(item), value) {
				return
			}
		}
	}
	header.Add("Vary", value)
}
