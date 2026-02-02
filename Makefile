.PHONY: help install migrate seed dev build start stop clean test

help: ## Mostrar este menu de ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Instalar dependências
	npm install

setup: ## Setup completo (Docker + migrations + seed)
	docker-compose up -d
	@echo "Aguardando bancos de dados..."
	@sleep 5
	npm run migrate
	npx tsx src/db/seed.ts
	@echo "✅ Setup completo! Execute 'make dev' para iniciar"

migrate: ## Executar migrations
	npm run migrate

seed: ## Executar seed (criar usuário inicial)
	npx tsx src/db/seed.ts

dev: ## Iniciar em modo desenvolvimento
	npm run dev

build: ## Build para produção
	npm run build

start: ## Iniciar em modo produção
	npm start

docker-up: ## Subir containers Docker
	docker-compose up -d

docker-down: ## Parar containers Docker
	docker-compose down

docker-logs: ## Ver logs dos containers
	docker-compose logs -f

clean: ## Limpar arquivos temporários e build
	rm -rf dist node_modules

reset: ## Reset completo (ATENÇÃO: apaga todos os dados!)
	docker-compose down -v
	rm -rf node_modules dist
	@echo "⚠️  Todos os dados foram apagados!"

test: ## Executar testes (placeholder)
	@echo "Testes ainda não implementados"

.DEFAULT_GOAL := help
