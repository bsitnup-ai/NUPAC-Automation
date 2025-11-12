# Use Node.js 22 (latest LTS)
FROM node:22

# Install dependencies for Chrome / Puppeteer
RUN apt-get update && apt-get install -y \
    wget gnupg ca-certificates \
    fonts-liberation libappindicator3-1 xdg-utils \
    libnss3 libxss1 libasound2 libatk-bridge2.0-0 libgtk-3-0 libdrm2 libx11-xcb1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy source code
COPY . .

# Expose app port
EXPOSE 4000

# Start the app
CMD ["node", "index.js"]
