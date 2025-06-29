FROM postgis/postgis:15-3.3-alpine

# Create directory for initialization scripts
RUN mkdir -p /docker-entrypoint-initdb.d

# Add initialization script
COPY init.sql /docker-entrypoint-initdb.d/

# Set environment variables
ENV POSTGRES_DB=tmss
ENV POSTGRES_USER=tmss
ENV POSTGRES_PASSWORD=tmss

# Ensure proper permissions
RUN chown -R postgres:postgres /docker-entrypoint-initdb.d

# Verify PostGIS installation
RUN ls -l /usr/local/share/postgresql/extension/postgis* 