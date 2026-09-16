package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"responsible-edu-agent/services/api-gateway-go/internal/store"
)

const participantCookieName = "rea_participant"
const adminCookieName = "rea_admin"

type participantStore interface {
	CreateParticipant(context.Context, string, bool) (store.Participant, string, error)
	GetParticipantByToken(context.Context, string) (store.Participant, error)
	LinkParticipantSession(context.Context, string, string) error
	ParticipantOwnsSession(context.Context, string, string) (bool, error)
	ListParticipantSessions(context.Context, string, string) ([]store.SessionSummary, error)
	GetTokenBudgetForScope(context.Context, string) (store.TokenBudget, error)
	RecordTokenUsageForScope(context.Context, string, int) (store.TokenBudget, error)
	ResetTokenBudgetForScope(context.Context, string) (store.TokenBudget, error)
}

func (g *Gateway) participantModeEnabled() bool {
	return g.appMode == "study" || g.appMode == "development"
}

func (g *Gateway) participantStorage() (participantStore, bool) {
	value, ok := g.store.(participantStore)
	return value, ok
}

func (g *Gateway) participantForRequest(response http.ResponseWriter, request *http.Request) (store.Participant, bool) {
	storage, ok := g.participantStorage()
	if !ok {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "participant_storage_unavailable"})
		return store.Participant{}, false
	}
	if cookie, err := request.Cookie(participantCookieName); err == nil {
		participant, lookupErr := storage.GetParticipantByToken(request.Context(), cookie.Value)
		if lookupErr == nil && (g.appMode != "study" || participant.ConsentedAt != "") {
			return participant, true
		}
	}
	if g.appMode == "study" {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "consent_required"})
		return store.Participant{}, false
	}
	participant, token, err := storage.CreateParticipant(request.Context(), "development", true)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "participant_create_failed"})
		return store.Participant{}, false
	}
	g.setParticipantCookie(response, request, token)
	return participant, true
}

func (g *Gateway) ParticipantStatus(response http.ResponseWriter, request *http.Request) {
	if !g.participantModeEnabled() {
		writeJSON(response, http.StatusOK, map[string]any{"mode": "development", "authenticated": true, "consent_required": false})
		return
	}
	storage, ok := g.participantStorage()
	if !ok {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "participant_storage_unavailable"})
		return
	}
	if cookie, err := request.Cookie(participantCookieName); err == nil {
		if participant, lookupErr := storage.GetParticipantByToken(request.Context(), cookie.Value); lookupErr == nil && (g.appMode != "study" || participant.ConsentedAt != "") {
			writeJSON(response, http.StatusOK, map[string]any{"mode": g.appMode, "authenticated": true, "consent_required": false})
			return
		}
	}
	if g.appMode == "development" {
		participant, token, err := storage.CreateParticipant(request.Context(), "development", true)
		if err != nil {
			writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "participant_create_failed"})
			return
		}
		_ = participant
		g.setParticipantCookie(response, request, token)
		writeJSON(response, http.StatusOK, map[string]any{"mode": g.appMode, "authenticated": true, "consent_required": false})
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"mode": g.appMode, "authenticated": false, "consent_required": true})
}

func (g *Gateway) ParticipantConsent(response http.ResponseWriter, request *http.Request) {
	if g.appMode != "study" {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "consent_not_required"})
		return
	}
	defer request.Body.Close()
	var input struct {
		Accepted bool `json:"accepted"`
	}
	if json.NewDecoder(request.Body).Decode(&input) != nil || !input.Accepted {
		writeJSON(response, http.StatusBadRequest, map[string]string{"error": "consent_required"})
		return
	}
	storage, ok := g.participantStorage()
	if !ok {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "participant_storage_unavailable"})
		return
	}
	_, token, err := storage.CreateParticipant(request.Context(), "study", true)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "participant_create_failed"})
		return
	}
	g.setParticipantCookie(response, request, token)
	writeJSON(response, http.StatusOK, map[string]any{"authenticated": true, "consent_required": false})
}

func (g *Gateway) setParticipantCookie(response http.ResponseWriter, request *http.Request, token string) {
	http.SetCookie(response, &http.Cookie{Name: participantCookieName, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: g.appMode == "study" || requestIsHTTPS(request), MaxAge: 60 * 60 * 24 * 30})
}

func requestIsHTTPS(request *http.Request) bool {
	return request.TLS != nil || strings.EqualFold(strings.TrimSpace(request.Header.Get("X-Forwarded-Proto")), "https")
}

func (g *Gateway) AdminStatus(response http.ResponseWriter, request *http.Request) {
	if g.adminAuthorized(request) {
		writeJSON(response, http.StatusOK, map[string]bool{"authenticated": true})
		return
	}
	writeJSON(response, http.StatusUnauthorized, map[string]bool{"authenticated": false})
}

func (g *Gateway) AdminLogin(response http.ResponseWriter, request *http.Request) {
	if g.appMode != "study" {
		writeJSON(response, http.StatusOK, map[string]bool{"authenticated": true})
		return
	}
	defer request.Body.Close()
	var input struct {
		Password string `json:"password"`
	}
	if json.NewDecoder(request.Body).Decode(&input) != nil || !constantTimeEqual(input.Password, g.adminPassword) {
		writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "invalid_admin_password"})
		return
	}
	http.SetCookie(response, &http.Cookie{Name: adminCookieName, Value: g.adminCookieValue(), Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: g.appMode == "study" || requestIsHTTPS(request), MaxAge: 60 * 60 * 8})
	writeJSON(response, http.StatusOK, map[string]bool{"authenticated": true})
}

func (g *Gateway) AdminLogout(response http.ResponseWriter, request *http.Request) {
	http.SetCookie(response, &http.Cookie{Name: adminCookieName, Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: g.appMode == "study" || requestIsHTTPS(request), MaxAge: -1, Expires: time.Unix(1, 0)})
	writeJSON(response, http.StatusOK, map[string]bool{"authenticated": false})
}

func (g *Gateway) RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(response http.ResponseWriter, request *http.Request) {
		if !g.adminAuthorized(request) {
			writeJSON(response, http.StatusUnauthorized, map[string]string{"error": "admin_authentication_required"})
			return
		}
		next(response, request)
	}
}

func (g *Gateway) adminAuthorized(request *http.Request) bool {
	if g.appMode != "study" {
		return true
	}
	if g.adminPassword == "" {
		return false
	}
	cookie, err := request.Cookie(adminCookieName)
	return err == nil && subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(g.adminCookieValue())) == 1
}

func (g *Gateway) adminDataAccess(request *http.Request) bool {
	return g.appMode == "study" &&
		request.Header.Get("X-REA-Admin-Access") == "1" &&
		g.adminAuthorized(request)
}

func (g *Gateway) adminCookieValue() string {
	mac := hmac.New(sha256.New, []byte(g.adminPassword))
	_, _ = mac.Write([]byte("responsible-edu-agent-admin"))
	return hex.EncodeToString(mac.Sum(nil))
}

func constantTimeEqual(left, right string) bool {
	if left == "" || right == "" || len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func (g *Gateway) participantOwnsSession(response http.ResponseWriter, request *http.Request, participantID, sessionID string) bool {
	storage, ok := g.participantStorage()
	if !ok {
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"error": "participant_storage_unavailable"})
		return false
	}
	owned, err := storage.ParticipantOwnsSession(request.Context(), participantID, sessionID)
	if err != nil {
		writeJSON(response, http.StatusInternalServerError, map[string]string{"error": "session_ownership_lookup_failed"})
		return false
	}
	if !owned {
		writeJSON(response, http.StatusNotFound, map[string]string{"error": "session_not_found"})
		return false
	}
	return true
}

func (g *Gateway) getTokenBudget(ctx context.Context, participantID string) (store.TokenBudget, error) {
	if participantID != "" {
		if storage, ok := g.participantStorage(); ok {
			return storage.GetTokenBudgetForScope(ctx, participantID)
		}
	}
	return g.store.GetTokenBudget(ctx)
}

func (g *Gateway) recordTokenUsage(ctx context.Context, participantID string, totalTokens int) (store.TokenBudget, error) {
	if participantID != "" {
		if storage, ok := g.participantStorage(); ok {
			return storage.RecordTokenUsageForScope(ctx, participantID, totalTokens)
		}
	}
	return g.store.RecordTokenUsage(ctx, totalTokens)
}

func beijingTimestamp() string {
	return time.Now().In(time.FixedZone("UTC+8", 8*60*60)).Format(time.RFC3339Nano)
}
