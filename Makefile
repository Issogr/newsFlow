.PHONY: install dev dev-backend dev-bff dev-frontend lint test build validate

install:
	cd backend && npm install
	cd bff && npm install
	cd frontend && npm install

dev:
	$(MAKE) -j3 dev-backend dev-bff dev-frontend

dev-backend:
	cd backend && npm run dev

dev-bff:
	cd bff && npm start

dev-frontend:
	cd frontend && npm run dev

lint:
	cd backend && npm run lint
	cd bff && npm run lint
	cd frontend && npm run lint

test:
	cd backend && npm test
	cd bff && npm test
	cd frontend && npm test

build:
	cd frontend && npm run build

validate: lint build test
