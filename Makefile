.PHONY: setup sync sync-visible dry-run scheduler install-browsers api frontend help

VENV     := .venv
PYTHON   := $(VENV)/bin/python
PIP      := $(VENV)/bin/pip

help:
	@echo "Usage:"
	@echo "  make setup         Create venv, install dependencies, install Playwright browsers"
	@echo "  make sync          Run nightly sync (headless)"
	@echo "  make sync-visible  Run sync with visible browser (useful for first-run / debugging)"
	@echo "  make dry-run       Discover new sessions without writing to DB"
	@echo "  make scheduler     Start the nightly scheduler daemon"
	@echo "  make api           Run FastAPI backend (port 8000)"
	@echo "  make frontend      Run React frontend (port 5173)"

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
	$(PYTHON) sync.py --headless

sync-visible: $(VENV)/bin/activate
	$(PYTHON) sync.py --no-headless

dry-run: $(VENV)/bin/activate
	$(PYTHON) sync.py --no-headless --dry-run

scheduler: $(VENV)/bin/activate
	$(PYTHON) -m scraper.scheduler

api: $(VENV)/bin/activate
	$(VENV)/bin/uvicorn api.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev: ## Run API + frontend in parallel (requires tmux or two terminals)
	@echo "Start 'make api' in one terminal and 'make frontend' in another."
