# ---- Base image ----
FROM node:20-slim

# ---- Install Chromium ----
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm-dev \
    libgtk-3-0 \
    libasound2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# ---- App setup ----
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# ---- Environment ----
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3000

# ---- Start ----
EXPOSE 3000
CMD ["node", "index.js"]
