FROM python:3.12-slim

# Install ffmpeg and clean up in one layer
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV PORT=8899

WORKDIR /app

# Install dependencies first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create directories that will be used for volumes
RUN mkdir -p data downloads cookies

# Copy the rest of the application
COPY . .

EXPOSE 8899
CMD ["python", "app.py"]
