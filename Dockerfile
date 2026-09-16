ARG BASE_IMAGE_REGISTRY=docker.1ms.run

FROM ${BASE_IMAGE_REGISTRY}/library/node:24-bookworm-slim AS frontend-builder

WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm config set registry https://registry.npmmirror.com \
  && cd frontend \
  && npm ci

COPY docs ./docs
COPY scripts ./scripts
COPY frontend ./frontend
COPY services/api-gateway-go/internal/web ./services/api-gateway-go/internal/web
RUN node scripts/generate_frontend_skill_data.mjs \
  && cd frontend \
  && npm run build \
  && npm run sync:go

FROM ${BASE_IMAGE_REGISTRY}/library/golang:1.25-bookworm AS go-builder

WORKDIR /src
COPY services/api-gateway-go ./services/api-gateway-go
COPY --from=frontend-builder /src/services/api-gateway-go/internal/web/dist ./services/api-gateway-go/internal/web/dist
WORKDIR /src/services/api-gateway-go
RUN go env -w GOPROXY=https://goproxy.cn,direct \
  && go mod download \
  && CGO_ENABLED=0 go build -o /out/responsible-api ./cmd/responsible-api

FROM ${BASE_IMAGE_REGISTRY}/library/python:3.12-slim AS runtime

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

COPY services/ai-core-python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY kg ./kg
COPY data/processed ./data/processed
COPY data/indexes ./data/indexes
COPY README.md Dockerfile check.sh ./
COPY docs ./docs
COPY scripts ./scripts
COPY harness ./harness
COPY frontend/package.json ./frontend/package.json
COPY frontend/src ./frontend/src
COPY docker ./docker
COPY services/ai-core-python ./services/ai-core-python
COPY services/api-gateway-go ./services/api-gateway-go
COPY services/api-gateway-go/etc/responsible-api.yaml ./responsible-api.yaml
COPY --from=go-builder /out/responsible-api ./responsible-api
COPY docker/start.sh ./start.sh
RUN mkdir -p /app/runtime \
  && sed -i 's/\r$//' ./start.sh \
  && chmod +x ./start.sh

EXPOSE 8080
CMD ["./start.sh"]

FROM runtime AS harness
