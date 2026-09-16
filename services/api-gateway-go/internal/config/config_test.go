package config

import (
	"testing"

	"github.com/zeromicro/go-zero/core/conf"
)

func TestResponsibleAPIConfigAllowsModelBackedSessionSteps(t *testing.T) {
	var config Config
	conf.MustLoad("../../etc/responsible-api.yaml", &config)

	if config.RestConf.Timeout < 30000 {
		t.Fatalf("go-zero request timeout must allow Qwen rewrite + rerank + teaching response, got %dms", config.RestConf.Timeout)
	}
}
