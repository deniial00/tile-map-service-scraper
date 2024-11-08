# docker/backend.Dockerfile
FROM python:3.11-slim-bullseye

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    gcc \
    curl \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set GDAL environment variables
ENV CPLUS_INCLUDE_PATH=/usr/include/gdal
ENV C_INCLUDE_PATH=/usr/include/gdal

# Install Python dependencies
COPY requirements-backend.txt .
RUN pip install --no-cache-dir -r requirements-backend.txt

# Copy application code
COPY backend/ .
COPY config/austria.* /app/config/

EXPOSE 8000

CMD ["uvicorn", "tile-server:app", "--host", "0.0.0.0", "--port", "8000"]
