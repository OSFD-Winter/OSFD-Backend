// @ts-nocheck
import express from "express";
import http from "http";
import cors from "cors";
import tokens from "./tokens";

const bp = require("body-parser");
const port = process.env.PORT || 8000;
const app = express();
const httpServer = http.createServer(app);

export class Router {
  constructor() {
    httpServer.listen(port, () => {
      console.log("server listening on port", port);
    });
    app.use(cors());
    app.use(bp.json());
    app.use(bp.urlencoded({ extended: true }));

    app.use("/tokens", tokens);

  }
}
