# 02 EviAgent System

The runnable EviAgent implementation remains in the repository root so that its
Docker build, automated checks, and internal paths continue to work.

## System map

| Area | Repository location |
| --- | --- |
| Learner and researcher interface | [`../../frontend/`](../../frontend/) |
| Python AI core | [`../../services/ai-core-python/`](../../services/ai-core-python/) |
| Go API gateway | [`../../services/api-gateway-go/`](../../services/api-gateway-go/) |
| Curriculum knowledge graph | [`../../kg/`](../../kg/) |
| Retrieval corpus and indexes | [`../../data/`](../../data/) |
| Evaluation harness | [`../../harness/`](../../harness/) |
| Reproducibility and integrity tools | [`../../scripts/`](../../scripts/) |
| Technical documentation | [`../../docs/`](../../docs/) |
| Selected visuals and poster | [`../../showcase/`](../../showcase/) |

See [`../../docs/architecture.md`](../../docs/architecture.md) for the system
architecture and the root [`../../README.md`](../../README.md) for local setup.
