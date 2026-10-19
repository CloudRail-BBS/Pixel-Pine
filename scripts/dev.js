"use strict";

// npm start 默认本地模式；显式设置 PS_MODE=cloud 可切回云端
process.env.PS_MODE = process.env.PS_MODE || "local";
require("../server.js");
