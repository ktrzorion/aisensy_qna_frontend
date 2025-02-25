# Use the official nginx image as a parent image
FROM nginx:alpine

# Copy all web files from your local machine to the container
# This will include index.html, script files, and style files
COPY . /usr/share/nginx/html/

# Nginx runs on port 80 by default, so we expose that port
EXPOSE 80

# When the container starts, nginx will start automatically