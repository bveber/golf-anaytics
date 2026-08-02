.PHONY: setup sync sync-visible dry-run install-browsers api frontend help docker-build docker-up docker-down docker-logs

VENV     := .venv
PYTHON   := $(VENV)/bin/python
PIP      := $(VENV)/bin/pip

help:
	@echo "Usage:"
	@echo "  make setup         Create venv, install dependencies, install Playwright browsers"
	@echo "  make sync          Run manual sync for user_id=1 (headless)"
	@echo "  make sync-visible  Run sync with visible browser (useful for first-run / debugging)"
	@echo "  make dry-run       Discover new sessions without writing to DB"
	@echo "  make api           Run FastAPI backend (port 8000) - also runs the nightly sync scheduler"
	@echo "  make frontend      Run React frontend (port 5173)"
	@echo "  make dev           Run API + frontend together, logs in logs/"
	@echo "  make docker-build  Build the api + frontend containers"
	@echo "  make docker-up     Start the app via docker compose (detached)"
	@echo "  make docker-down   Stop the docker compose app"
	@echo "  make docker-logs   Tail logs from both containers"

debug: $(VENV)/bin/activate
	$(PYTHON) debug_scraper.py

setup: $(VENV)/bin/activate install-browsers

$(VENV)/bin/activate: requirements.txt
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	@touch $(VENV)/bin/activate

install-browsers: $(VENV)/bin/activate
	$(PYTHON) -m playwright install chromium

sync: $(VENV)/bin/activate
	$(PYTHON) sync.py --user-id 1 --headless

sync-visible: $(VENV)/bin/activate
	$(PYTHON) sync.py --user-id 1 --no-headless

dry-run: $(VENV)/bin/activate
	$(PYTHON) sync.py --user-id 1 --no-headless --dry-run

api: $(VENV)/bin/activate
	$(VENV)/bin/uvicorn api.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev: ## Run API + frontend together, tailing logs to logs/api.log and logs/frontend.log
	@bash scripts/dev.sh

docker-build:
	docker compose build

docker-up: ## Start via docker compose (generates a throwaway local cert on first run - prod fetches its real one from SSM via scripts/deploy.sh)
	@mkdir -p certs
	@[ -f certs/origin.crt ] || openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
		-keyout certs/origin.key -out certs/origin.crt -days 365 -nodes -subj "/CN=localhost"
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f
