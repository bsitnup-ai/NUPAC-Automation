 # Use latest Node.js 22 LTS
FROM node:22-slim

# Install system dependencies for Chrome / Puppeteer
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    fonts-liberation libappindicator3-1 xdg-utils \
    libnss3 libxss1 libasound2 libatk-bridge2.0-0 libgtk-3-0 libdrm2 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies (no cache to keep image light)
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Create persistent folder for WhatsApp session
RUN mkdir -p /app/.wwebjs_auth
VOLUME ["/app/.wwebjs_auth"]

# Expose the app’s port (adjust if your index.js uses another one)
EXPOSE 4000

# Default start command
CMD ["node", "index.js"]

