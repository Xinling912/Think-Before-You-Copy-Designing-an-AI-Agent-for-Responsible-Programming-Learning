package app

import (
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompressionHandlerGzipsEligibleJSON(t *testing.T) {
	handler := CompressionHandler(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Content-Length", "18")
		_, _ = response.Write([]byte(`{"nodes":["list"]}`))
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/kg/overview", nil)
	request.Header.Set("Accept-Encoding", "br, gzip")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if got := response.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := response.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary = %q, want Accept-Encoding", got)
	}
	if got := response.Header().Get("Content-Length"); got != "" {
		t.Fatalf("Content-Length = %q, want empty", got)
	}
	if got := gunzipBody(t, response.Body.Bytes()); got != `{"nodes":["list"]}` {
		t.Fatalf("decoded body = %q", got)
	}
}

func TestCompressionHandlerLeavesResponseUnchangedWithoutGzipNegotiation(t *testing.T) {
	handler := CompressionHandler(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"status":"ok"}`))
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/kg/overview", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if got := response.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want empty", got)
	}
	if got := response.Body.String(); got != `{"status":"ok"}` {
		t.Fatalf("body = %q", got)
	}
}

func TestCompressionHandlerLeavesStreamingChatUncompressed(t *testing.T) {
	handler := CompressionHandler(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = response.Write([]byte("{\"type\":\"trace_started\"}\n"))
	}))
	request := httptest.NewRequest(http.MethodPost, "/api/session/message/stream", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if got := response.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding = %q, want empty", got)
	}
	if got := response.Body.String(); got != "{\"type\":\"trace_started\"}\n" {
		t.Fatalf("body = %q", got)
	}
}

func TestCompressionHandlerGzipsFrontendJavaScript(t *testing.T) {
	handler := CompressionHandler(FrontendHandler(testFrontendFS()))
	request := httptest.NewRequest(http.MethodGet, "/umi.js", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if got := response.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := gunzipBody(t, response.Body.Bytes()); got != `console.log("frontend");` {
		t.Fatalf("decoded body = %q", got)
	}
}

func gunzipBody(t *testing.T, body []byte) string {
	t.Helper()
	reader, err := gzip.NewReader(strings.NewReader(string(body)))
	if err != nil {
		t.Fatalf("new gzip reader: %v", err)
	}
	decompressed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("read gzip body: %v", err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close gzip reader: %v", err)
	}
	return string(decompressed)
}
