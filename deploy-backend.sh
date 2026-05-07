#!/bin/bash

# PrintMRP Backend Deployment Script
# Usage: ./deploy-backend.sh [up|down|logs|restart|build]

set -e

COMMAND=${1:-up}
COMPOSE_FILE="docker-compose.backend.yml"
ENV_FILE=".env"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if docker-compose is available
if ! command -v docker compose &> /dev/null; then
  echo -e "${RED}Error: Docker Compose is not installed${NC}"
  exit 1
fi

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}Warning: .env file not found${NC}"
  echo "Creating .env from .env.example..."
  cp .env.example "$ENV_FILE"
  echo -e "${YELLOW}Please edit .env with your configuration before deploying${NC}"
  exit 1
fi

case "$COMMAND" in
  up)
    echo -e "${GREEN}Starting PrintMRP Backend...${NC}"
    docker compose -f "$COMPOSE_FILE" up -d --build
    echo -e "${GREEN}✓ Backend is running!${NC}"
    echo "  API: http://localhost:4000"
    echo "  Health: http://localhost:4000/health"
    echo ""
    echo "View logs: docker compose -f $COMPOSE_FILE logs -f backend"
    ;;

  down)
    echo -e "${YELLOW}Stopping PrintMRP Backend...${NC}"
    docker compose -f "$COMPOSE_FILE" down
    echo -e "${GREEN}✓ Backend stopped${NC}"
    ;;

  down-v)
    echo -e "${RED}⚠️  Stopping backend and DELETING database...${NC}"
    read -p "Are you sure? Type 'yes' to confirm: " confirm
    if [ "$confirm" = "yes" ]; then
      docker compose -f "$COMPOSE_FILE" down -v
      echo -e "${GREEN}✓ Backend stopped and database deleted${NC}"
    else
      echo "Cancelled"
      exit 1
    fi
    ;;

  restart)
    echo -e "${YELLOW}Restarting PrintMRP Backend...${NC}"
    docker compose -f "$COMPOSE_FILE" restart
    echo -e "${GREEN}✓ Backend restarted${NC}"
    ;;

  logs)
    docker compose -f "$COMPOSE_FILE" logs -f backend
    ;;

  logs-db)
    docker compose -f "$COMPOSE_FILE" logs -f db
    ;;

  build)
    echo -e "${GREEN}Building Docker image...${NC}"
    docker compose -f "$COMPOSE_FILE" build --no-cache
    echo -e "${GREEN}✓ Build complete${NC}"
    ;;

  ps)
    echo -e "${GREEN}Container Status:${NC}"
    docker compose -f "$COMPOSE_FILE" ps
    ;;

  shell)
    echo -e "${GREEN}Opening backend shell...${NC}"
    docker compose -f "$COMPOSE_FILE" exec backend /bin/sh
    ;;

  db-shell)
    echo -e "${GREEN}Opening database shell...${NC}"
    docker compose -f "$COMPOSE_FILE" exec db psql -U printmrp -d printmrp
    ;;

  migrate)
    echo -e "${GREEN}Running migrations...${NC}"
    docker compose -f "$COMPOSE_FILE" exec backend npm run prisma:migrate
    echo -e "${GREEN}✓ Migrations complete${NC}"
    ;;

  seed)
    echo -e "${GREEN}Seeding database...${NC}"
    docker compose -f "$COMPOSE_FILE" exec backend npm run seed
    echo -e "${GREEN}✓ Database seeded${NC}"
    ;;

  health)
    echo -e "${GREEN}Checking backend health...${NC}"
    if curl -s http://localhost:4000/health | grep -q "ok"; then
      echo -e "${GREEN}✓ Backend is healthy${NC}"
    else
      echo -e "${RED}✗ Backend health check failed${NC}"
      exit 1
    fi
    ;;

  *)
    echo "PrintMRP Backend Deployment Script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  up           Start backend with database (default)"
    echo "  down         Stop backend (keep data)"
    echo "  down-v       Stop backend and DELETE database (destructive)"
    echo "  restart      Restart backend services"
    echo "  logs         View backend logs (tail)"
    echo "  logs-db      View database logs (tail)"
    echo "  build        Rebuild Docker image"
    echo "  ps           Show container status"
    echo "  shell        Open backend shell"
    echo "  db-shell     Open database shell"
    echo "  migrate      Run database migrations"
    echo "  seed         Seed database"
    echo "  health       Check if backend is healthy"
    echo ""
    echo "Examples:"
    echo "  $0 up                 # Start everything"
    echo "  $0 logs               # Follow backend logs"
    echo "  $0 db-shell           # Access database"
    echo ""
    exit 1
    ;;
esac
