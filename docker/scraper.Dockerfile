# docker/scraper.Dockerfile
FROM python:3.11-slim-bullseye

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gdal-bin \
    libgdal-dev \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements-scraper.txt .
RUN pip install --no-cache-dir -r requirements-scraper.txt

# Copy application code
COPY scraper/ .
COPY config/austria.* /app/config/

CMD ["python", "tms-scraper.py"]
