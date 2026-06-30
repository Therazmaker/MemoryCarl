FROM ghcr.io/puppeteer/puppeteer:latest

# Cambiamos al usuario root temporalmente para crear el directorio de trabajo
USER root
WORKDIR /app

# Copiamos package.json y instalamos dependencias de node
COPY package*.json ./
RUN npm install

# Copiamos el resto del código
COPY . .

# Cambiamos de nuevo al usuario node (pptruser) por seguridad
USER pptruser

# Comando para iniciar el bot
CMD ["node", "index.js"]
