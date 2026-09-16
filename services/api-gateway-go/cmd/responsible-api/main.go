package main

import (
	"context"
	"flag"
	"net/http"
	"os"
	"strings"

	"responsible-edu-agent/services/api-gateway-go/internal/app"
	"responsible-edu-agent/services/api-gateway-go/internal/config"
	"responsible-edu-agent/services/api-gateway-go/internal/store"
	"responsible-edu-agent/services/api-gateway-go/internal/web"

	"github.com/zeromicro/go-zero/core/conf"
	"github.com/zeromicro/go-zero/rest"
)

var configFile = flag.String("f", "etc/responsible-api.yaml", "the config file")

func main() {
	flag.Parse()

	var c config.Config
	conf.MustLoad(*configFile, &c)

	server := rest.MustNewServer(c.RestConf, rest.WithNotFoundHandler(app.GatewayNotFoundHandler(web.Dist(), c.AICoreURL)))
	defer server.Stop()
	server.Use(rest.ToMiddleware(app.CompressionHandler))

	sqliteStore, err := store.OpenSQLite(c.SQLiteDSN)
	if err != nil {
		panic(err)
	}
	defer sqliteStore.Close()
	if c.SeedDemoData {
		if _, err := sqliteStore.SeedDemoData(context.Background()); err != nil {
			panic(err)
		}
	}

	gateway := app.NewGateway(app.Config{
		AICoreURL:     c.AICoreURL,
		Store:         sqliteStore,
		AppMode:       appMode(),
		AdminPassword: os.Getenv("STUDY_ADMIN_PASSWORD"),
	})
	server.AddRoutes([]rest.Route{
		{Method: http.MethodGet, Path: "/api/health", Handler: gateway.Health},
		{Method: http.MethodGet, Path: "/api/participant/status", Handler: gateway.ParticipantStatus},
		{Method: http.MethodPost, Path: "/api/participant/consent", Handler: gateway.ParticipantConsent},
		{Method: http.MethodGet, Path: "/api/admin/status", Handler: gateway.AdminStatus},
		{Method: http.MethodPost, Path: "/api/admin/login", Handler: gateway.AdminLogin},
		{Method: http.MethodPost, Path: "/api/admin/logout", Handler: gateway.AdminLogout},
		{Method: http.MethodGet, Path: "/api/skills", Handler: gateway.Skills},
		{Method: http.MethodGet, Path: "/api/kg/path", Handler: gateway.KGPath},
		{Method: http.MethodGet, Path: "/api/kg/overview", Handler: gateway.KGOverview},
		{Method: http.MethodGet, Path: "/api/kg/candidates", Handler: gateway.RequireAdmin(gateway.KGCandidates)},
		{Method: http.MethodPost, Path: "/api/kg/candidates/:id/review", Handler: gateway.RequireAdmin(gateway.KGCandidateReview)},
		{Method: http.MethodGet, Path: "/api/learner/profile", Handler: gateway.RequireAdmin(gateway.LearnerProfile)},
		{Method: http.MethodGet, Path: "/api/tests/topics", Handler: gateway.TestTopics},
		{Method: http.MethodPost, Path: "/api/tests/question", Handler: gateway.TestQuestion},
		{Method: http.MethodGet, Path: "/api/tests/question/:id", Handler: gateway.ReloadTestQuestion},
		{Method: http.MethodPost, Path: "/api/tests/answer", Handler: gateway.TestAnswer},
		{Method: http.MethodGet, Path: "/api/token-budget", Handler: gateway.TokenBudget},
		{Method: http.MethodPost, Path: "/api/token-budget/reset", Handler: gateway.RequireAdmin(gateway.ResetTokenBudget)},
		{Method: http.MethodGet, Path: "/api/corpus/summary", Handler: gateway.RequireAdmin(gateway.CorpusSummary)},
		{Method: http.MethodGet, Path: "/api/corpus/chunks", Handler: gateway.RequireAdmin(gateway.CorpusChunks)},
		{Method: http.MethodGet, Path: "/api/corpus/chunks/:id", Handler: gateway.RequireAdmin(gateway.CorpusChunkDetail)},
		{Method: http.MethodGet, Path: "/api/corpus/glossary", Handler: gateway.RequireAdmin(gateway.CorpusGlossary)},
		{Method: http.MethodPost, Path: "/api/session/start", Handler: gateway.SessionStart},
		{Method: http.MethodGet, Path: "/api/session/current", Handler: gateway.CurrentSession},
		{Method: http.MethodPost, Path: "/api/session/message", Handler: gateway.SessionMessage},
		{Method: http.MethodPost, Path: "/api/session/message/stream", Handler: gateway.SessionMessageStream},
		{Method: http.MethodGet, Path: "/api/sessions", Handler: gateway.Sessions},
		{Method: http.MethodGet, Path: "/api/session/:id", Handler: gateway.SessionDetail},
		{Method: http.MethodDelete, Path: "/api/session/:id", Handler: gateway.DeleteSession},
		{Method: http.MethodGet, Path: "/api/session/:id/evidence", Handler: gateway.RequireAdmin(gateway.SessionEvidence)},
		{Method: http.MethodGet, Path: "/api/harness/suites", Handler: gateway.RequireAdmin(gateway.HarnessSuites)},
		{Method: http.MethodGet, Path: "/api/harness/cases", Handler: gateway.RequireAdmin(gateway.HarnessCases)},
		{Method: http.MethodPost, Path: "/api/harness/cases/compile", Handler: gateway.RequireAdmin(gateway.HarnessCaseCompile)},
		{Method: http.MethodPost, Path: "/api/harness/cases/:case_id/confirm", Handler: gateway.RequireAdmin(gateway.HarnessCaseConfirm)},
		{Method: http.MethodDelete, Path: "/api/harness/cases/:case_id", Handler: gateway.RequireAdmin(gateway.HarnessCaseDelete)},
		{Method: http.MethodPost, Path: "/api/harness/run", Handler: gateway.RequireAdmin(gateway.HarnessRun)},
	})

	server.Start()
}

func appMode() string {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("APP_MODE")))
	if mode == "study" {
		if strings.TrimSpace(os.Getenv("STUDY_ADMIN_PASSWORD")) == "" {
			panic("STUDY_ADMIN_PASSWORD is required in study mode")
		}
		return mode
	}
	return "development"
}
