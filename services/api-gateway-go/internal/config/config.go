package config

import "github.com/zeromicro/go-zero/rest"

type Config struct {
	rest.RestConf
	AICoreURL    string
	SQLiteDSN    string
	CorpusDir    string
	SeedDemoData bool
}
