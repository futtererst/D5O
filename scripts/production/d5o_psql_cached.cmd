@echo off
rem PostgreSQL client adapter for the guarded production runner.
rem Credentials are supplied only through inherited PG* environment variables.
docker run --rm -i --pull never --read-only --cap-drop ALL --security-opt no-new-privileges --network bridge -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER -e PGPASSWORD -e PGSSLMODE sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 psql %*
exit /b %ERRORLEVEL%
