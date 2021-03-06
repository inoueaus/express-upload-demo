import express from "express";
import bodyParser from "body-parser";
import path from "path";
import https from "https";
import { readFileSync, createReadStream } from "fs";
import multer from "multer";

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, "uploads");
  },
  filename(req, file, callback) {
    callback(null, `${new Date().getTime()}-${file.originalname}`);
  },
});

const upload = multer({
  dest: path.resolve(__dirname, "../uploads/"),
  storage,
  fileFilter(req, file, callback) {
    if (["text/csv", "image/png"].includes(file.mimetype)) {
      callback(null, true);
    }
    callback(null, true);
  },
});

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "views"));
app.use("/public", express.static(path.resolve(__dirname, "../public")));

const server = https.createServer(
  {
    key: readFileSync(path.resolve(__dirname, "../key.pem")),
    cert: readFileSync(path.resolve(__dirname, "../cert.pem")),
  },
  app
);

app.get("/", (req, res) => {
  res.render(path.join(__dirname, "index.ejs"), { message: "Hello World" });
});

app.get("/uploads/:fileName", (req, res) => {
  console.log(req.params.fileName);
  const fileStream = createReadStream(
    path.resolve(__dirname, "../uploads", req.params.fileName)
  );
  fileStream.pipe(res);
});

app.post("/", upload.single("file"), (req, res) => {
  console.log(req.file);
  if (!req.file) {
    return res.render(path.join(__dirname, "index.ejs"), {
      message: "Invalid Format",
    });
  }
  res.redirect(`/uploads/${req.file.filename}`);
});

app.get("/video", (req, res) => {
  res.render("video.ejs");
});

app.put("/video", upload.single("file"), (req, res) => {
  console.log(req.file);
  res.json({})
});

const port = 4000;
server.listen(port, () => {
  console.log(`Listening on Port: ${port}`);
});
