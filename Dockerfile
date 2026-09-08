FROM golang:1.23-alpine

WORKDIR /app

COPY . .

RUN go mod tidy

EXPOSE 8080

CMD ["sh", "-c", "go run cmd/server/main.go"]
