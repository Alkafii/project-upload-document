import express from "express";

import {
    showUploadForm,
    uploadDocuments,
} from "../controllers/document.controller.js";

import upload from "../middlewares/upload.middleware.js";

const router = express.Router();

router.get("/upload", showUploadForm);

router.post("/upload",
    upload.any(),
    uploadDocuments
);

export default router;