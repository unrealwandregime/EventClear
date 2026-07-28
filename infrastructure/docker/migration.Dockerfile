FROM postgres:17-alpine
COPY infrastructure/docker/postgres/migrations /migrations
CMD ["sh", "-c", "for migration in /migrations/*.sql; do psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f \"$migration\"; done"]
