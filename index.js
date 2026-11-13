import express from "express";
import bodyParser from "body-parser";
import multer from "multer";
import path from "path";
import fs from "fs";
import pg from "pg";
import env from "dotenv";
import { nanoid } from "nanoid";
import session from "express-session";
import flash from "connect-flash";
import connectPgSimple from "connect-pg-simple";

env.config();

const app = express();
const port = 3000;


// Database connection
const db = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT),
});


// Session dan flash
const PgSession = connectPgSimple(session);

const sessionMiddleware = session({
  store: new PgSession({
    pool: db,
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),

  secret: process.env.SESSION_SECRET,

  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24,
  },
});

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(sessionMiddleware);
app.use(flash());

// Multer config
const targetLocation = "./data/uploaded_file";
// let sessionMessage = "";

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    try {
      if (!req.customFolderPath) {
        const id = req.query.id;

        if (id) {
          const dataDb = (await db.query("SELECT folder_name FROM upload_document WHERE id = $1", [id])).rows;
          if (dataDb.length > 0 && dataDb[0].folder_name) {
            req.customFolderPath = path.join(targetLocation, dataDb[0].folder_name);
          }
        }

        if (!req.customFolderPath) {
          const institution = req.body.institutionName || "Unknown";
          const integration = req.body.integrationType || "General";
          const vaType = req.body.vaType || " ";
          const nanoId = nanoid(10);

          const customFolderName = `${institution}-${integration} ${vaType}-${nanoId}`;
          req.customFolderPath = path.join(targetLocation, customFolderName);
        }
      }

      if (!fs.existsSync(req.customFolderPath)) {
          fs.mkdirSync(req.customFolderPath, { recursive: true });
      }

      cb(null, req.customFolderPath);
    } catch(err) {
        console.log(err);
        cb(err);
    }  
  },
  filename: function (req, file, cb) {
    try {  
        const uniqueSuffix = Date.now();      
        const ext = path.extname(file.originalname);
        const newFileName = `${file.fieldname}-${uniqueSuffix}${ext}`;
        
        const folderNameOnly = path.basename(req.customFolderPath);
        const databaseSavePath = `${folderNameOnly}/${newFileName}`;
        
        if (!req.uploadedPaths) req.uploadedPaths = [];
        req.uploadedPaths.push(databaseSavePath);

        cb(null, newFileName);

    } catch(err) {
        console.log(err);
        cb(err);
    }
  }
});

// const upload = multer({ storage: storage });
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", // .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ];

  const allowedExts = [".pdf", ".doc", ".docx", ".xls", ".xlsx"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedMimes.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true); // File diterima
  } else {
    cb(new Error("Format file tidak valid! Hanya diperbolehkan PDF, Word, dan Excel."), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024
  }
});



// Homepage
app.get("/",async (req, res) => {
  try {
      const dataDb = (await db.query("SELECT * FROM upload_document ORDER BY id ASC")).rows;
      let tableData = "";

      let data = {
        institution: "",
        integration: "",
        create_date: "",
        rowData: "",
        message: req.flash("success")[0] || ""
      };

      if(dataDb.length > 0) {
        for(let i = 0; i < dataDb.length; i++) {
          const totalDocument = dataDb[i];
          const targetDocument = (totalDocument.va_type === "Off Us" || totalDocument.api_name === "QRIS MPM SNAP") ? 20 : 22;
          const filesArray = typeof totalDocument.uploaded_files === "string" ? JSON.parse(totalDocument.uploaded_files) : (totalDocument.uploaded_files || []);
          tableData += `<div class="row no-gutters p-3 text-center align-items-center bg-white border-bottom">
                          <div class="col-1 text-left pl-3 font-weight-bold text-muted">${i + 1}</div>
                          <div class="col-3 text-left font-weight-bold text-dark">${dataDb[i].name}</div>
                          <div class="col-2 text-left text-monospace text-secondary">${dataDb[i].api_name} ${dataDb[i].va_type}</div>
                          <div class="col-2 text-left">${dataDb[i].created_at}</div>
                          <div class="col-2 text-left">${dataDb[i].updated_at}</div>
                          <div class="col-1 text-center"><b>${filesArray.length}</b>/${targetDocument}</div>
                          <div class="col-1 dropdown">
                            <button class="btn btn-sm btn-outline-secondary dropdown-toggle py-0" type="button" id="dropdownMenuButton${i}" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                                Edit
                            </button>
                            <div class="dropdown-menu dropdown-menu-right" aria-labelledby="dropdownMenu2">
                              <a class="dropdown-item" href="/read_data?id=${dataDb[i].id}">Update</a>
                              <button type="button" class="dropdown-item text-danger" data-toggle="modal" data-target="#deleteModal" data-id="${dataDb[i].id}" data-name="${dataDb[i].name}">
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>`;
        }
        data.rowData = tableData;
      } else {
        data.rowData = `<div class="row no-gutters p-4 text-center bg-white text-muted justify-content-center">Belum ada data integrasi API.</div>`;
      }

      res.render("index.ejs", data);
  } catch(err) {
      console.log(err);
      res.status(500).send("Terjadi kesalahan pada server. Silakan coba beberapa saat lagi.");
  }
});


// Upload document
app.get("/upload", (req, res) => {
  try {
      res.render("upload.ejs", { message: req.flash("success")[0] || "", errorMessage: req.flash("error")[0] || "", });
  } catch(err) {
      console.log(err);
      res.status(500).send("Terjadi kesalahan pada server. Silakan coba beberapa saat lagi.");
  }
})

app.post("/upload", upload.fields([
  { name: "Form_Pendaftaran_API", maxCount: 1 },
  { name: "Memo_Bisnis", maxCount: 1 },
  { name: "BRD", maxCount: 1 },
  { name: "Form_Deployment", maxCount: 1 },
  { name: "Outline_SIT", maxCount: 1 },
  { name: "BA_UAT", maxCount: 1 },
  { name: "Memo_IT", maxCount: 1 },
  { name: "Surat_Permohonan_Verifikasi", maxCount: 1 },
  { name: "Surat_Kebenaran", maxCount: 1 },
  { name: "Surat_Kesesuaian", maxCount: 1 },
  { name: "Matriks_Penjelasan_SOP", maxCount: 1 },
  { name: "SOP_Penyedia", maxCount: 1 },
  { name: "24 - API Virtual Account - Inquiry - Positif", maxCount: 1 },
  { name: "24 - API Virtual Account - Inquiry - Negatif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment - Positif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment - Negatif", maxCount: 1 },
  { name: "26 - API Virtual Account - Inquiry Status - Positif", maxCount: 1 },
  { name: "26 - API Virtual Account - Inquiry Status - Negatif", maxCount: 1 },
  { name: "27 - API Virtual Account - Create VA - Positif", maxCount: 1 },
  { name: "27 - API Virtual Account - Create VA - Negatif", maxCount: 1 },
  { name: "30 - API Virtual Account - Inquiry VA - Positif", maxCount: 1 },
  { name: "30 - API Virtual Account - Inquiry VA - Negatif", maxCount: 1 },
  { name: "28 - API Virtual Account - Update VA - Positif", maxCount: 1 },
  { name: "28 - API Virtual Account - Update VA - Negatif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment VA - Positif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment VA - Negatif", maxCount: 1 },
  { name: "47 - API Generate QR MPM - Positif", maxCount: 1 },
  { name: "47 - API Generate QR MPM - Negatif", maxCount: 1 },
  { name: "51 - API Query Payment - Positif", maxCount: 1 },
  { name: "51 - API Query Payment - Negatif", maxCount: 1 },
  { name: "52 - API Payment Notification - Positif", maxCount: 1 },
  { name: "52 - API Payment Notification - Negatif", maxCount: 1 },
  { name: "BA_Uji_Fungsi", maxCount: 1 },
  { name: "Hasil_Uji_Fungsi", maxCount: 1 }
]),async (req, res) => {
  try {
      if (!req.files || Object.keys(req.files).length === 0) {
        req.flash("error", "Anda belum upload dokumen!")
        return res.redirect("/upload");
      }

      const institution = req.body.institutionName || "Unknown";
      let integration = req.body.integrationType || "General";
      const vaType = req.body.vaType || " ";
      const date = new Date().toLocaleString('sv-SE');

      const uploadedDocuments = [];
      let folderName = "Unknown-Folder";

      for (const fieldName in req.files) {
        const fileObject = req.files[fieldName][0]; 
        const filenameWithExt = fileObject.filename; 
        
        uploadedDocuments.push(filenameWithExt);

        if (folderName === "Unknown-Folder" && fileObject.destination) {
          folderName = path.basename(fileObject.destination);
        }
      }
  
      await db.query("INSERT INTO upload_document (name, api_name, va_type, folder_name, created_at, updated_at, uploaded_files) VALUES ($1, $2, $3, $4, $5, $6, $7)", [institution, integration, vaType, folderName, date, date, JSON.stringify(uploadedDocuments)]);

      req.flash("success", "Dokumen berhasil diupload");
      return res.redirect("/");
  } catch(err) {
      console.log(err);
      res.status(500).send("Terjadi kesalahan pada server. Silakan coba beberapa saat lagi.");
  }
});


// Read detaile document
app.get("/read_data", async (req, res) => {
  try {
    const id = req.query.id;

    if (typeof id === "undefined" || id === "") {
      return res.status(400).send("ID data tidak valid.");
      
    } else {
      const dataDb = (await db.query("SELECT * FROM upload_document WHERE id = $1", [id])).rows;
      const targetData = dataDb[0]; 

      if (!targetData) {
        return res.status(404).send("Data yang anda cari tidak ditemukan!.");
        
      } else {
        let uploaded_file = [];
        const dbFiles = targetData.uploaded_files || targetData.uploaded_files;
        if (dbFiles) {
          try {
            uploaded_file = typeof dbFiles === "string" ? JSON.parse(dbFiles) : dbFiles;
          } catch (err) {
            console.log("Gagal parse JSON dari DB, beralih ke pembacaan folder.");
          }
        }
        
        const REQUIRED_DOCUMENTS = [
          "Form_Pendaftaran_API", "Memo_Bisnis", "BRD", "Form_Deployment", "Outline_SIT", "BA_UAT", "Memo_IT",
          "Surat_Permohonan_Verifikasi", "Surat_Kebenaran", "Surat_Kesesuaian", "Matriks_Penjelasan_SOP", "SOP_Penyedia",
          "24 - API Virtual Account - Inquiry - Positif", "24 - API Virtual Account - Inquiry - Negatif",
          "25 - API Virtual Account - Payment - Positif", "25 - API Virtual Account - Payment - Negatif",
          "26 - API Virtual Account - Inquiry Status - Positif", "26 - API Virtual Account - Inquiry Status - Negatif",
          "27 - API Virtual Account - Create VA - Positif", "27 - API Virtual Account - Create VA - Negatif",
          "30 - API Virtual Account - Inquiry VA - Positif", "30 - API Virtual Account - Inquiry VA - Negatif",
          "28 - API Virtual Account - Update VA - Positif", "28 - API Virtual Account - Update VA - Negatif",
          "25 - API Virtual Account - Payment VA - Positif", "25 - API Virtual Account - Payment VA - Negatif",
          "47 - API Generate QR MPM - Positif", "47 - API Generate QR MPM - Negatif", "51 - API Query Payment - Positif",
          "51 - API Query Payment - Negatif", "52 - API Payment Notification - Positif", "52 - API Payment Notification - Negatif",
          "BA_Uji_Fungsi", "Hasil_Uji_Fungsi"
        ];

        let fields = {};

        for (let i = 0; i < REQUIRED_DOCUMENTS.length; i++) {
          const docName = REQUIRED_DOCUMENTS[i];

          const foundFileName = uploaded_file.find(function(file) {
            return file.startsWith(docName);
          });
          
          let isUploaded = (foundFileName !== undefined);

          if (isUploaded) {
            fields[docName] = `<div class="custom-file">
                                  <input type="file" class="custom-file-input" name="${docName}" id="doc_${i}" accept=".pdf,.doc,.docx,.xls,.xlsx" style="cursor: pointer;" />
                                  <label class="custom-file-label text-truncate text-success" for="doc_${i}" id="label_doc_${i}" data-browse="🗙" style="padding-right: 50px; font-weight: 500;" >
                                    ${foundFileName}
                                  </label>
                                  <button type="button" 
                                      class="position-absolute h-100 d-flex align-items-center justify-content-center text-decoration-none text-secondary" 
                                      style="right: 0; top: 0; width: 42px; z-index: 10; background-color: #e9ecef; border-left: 1px solid #ced4da; border-radius: 0 0.25rem 0.25rem 0; font-size: 16px; cursor: pointer; border: none;"
                                      title="Hapus berkas ini"
                                      data-toggle="modal" 
                                      data-target="#modalDeleteConfirmation"
                                      data-id="${id}"
                                      data-filename="${foundFileName}">
                                        🗙
                                  </button>
                               </div>
                              <small class="form-text text-muted">Document has been saved, click <a href="/download_file?id=${id}&fileName=${foundFileName}" target="_blank" class="font-weight-bold text-primary"> here </a> to download this document.</small>`;
          } else {
            fields[docName] = `<div class="custom-file">
                                  <input type="file" class="custom-file-input" name="${docName}" id="doc_${i}" accept=".pdf,.doc,.docx,.xls,.xlsx">
                                  <label class="custom-file-label text-truncate text-muted" id="label_doc_${i}" for="doc_${i}" data-browse="🗀" style="padding-right: 50px;">Choose file</label>
                              </div>
                              <small class="form-text text-muted">File formats: PDF, DOCX, XLSX.</small>`;
          }
        }

        const formatCreateDate = targetData.created_at ? targetData.created_at.toString().slice(0, 33) : "-";
        
        let data = {
          id: id,
          institution: targetData.name, 
          integration: targetData.api_name,
          vaType: targetData.va_type,
          create_date: formatCreateDate,
          message: req.flash("success")[0] || "",
          errorMessage: req.flash("error")[0] || "",
          fields: fields
        };

        res.render("read_data.ejs", data);
      }
    }
  } catch (err) {
    console.error("Error pada rute read_data:", err);
    res.status(500).send("Terjadi kesalahan pada sistem.");
  }
});


// Delete file
app.get("/delete_file", async (req, res) => {
  try {
    const id = req.query.id;
    const fileName = req.query.fileName;

    if (!id || !fileName) {
      return res.status(400).send("ID dan nama file wajib diisi.");
    }

    const dataDb = (await db.query("SELECT folder_name, uploaded_files FROM upload_document WHERE id = $1", [id])).rows;

    if (dataDb.length === 0) {
      return res.status(404).send("Data integrasi tidak ditemukan.");
    }

    const folderName = dataDb[0].folder_name;
    const date = new Date().toLocaleString("sv-SE");

    if (!folderName) {
      return res.status(400).send("Folder penyimpanan tidak ditemukan.");
    }

    const targetData = dataDb[0].uploaded_files;

    const arrayFile =
      typeof targetData === "string" ? JSON.parse(targetData) : targetData || [];

    if (!arrayFile.includes(fileName)) {
      return res.status(404).send("Dokumen tidak ditemukan.");
    }

    if (path.basename(folderName) !== folderName || path.basename(fileName) !== fileName) {
      return res.status(400).send("Nama folder atau file tidak valid.");
    }

    const baseFolder = path.resolve(process.cwd(), "data", "uploaded_file");
    const folderPath = path.resolve(baseFolder, folderName);
    const filePath = path.resolve(folderPath, fileName);

    const relativeFolder = path.relative(baseFolder, folderPath);
    const relativeFile = path.relative(folderPath, filePath);

    if (
      relativeFolder.startsWith("..") ||
      path.isAbsolute(relativeFolder) ||
      relativeFile.startsWith("..") ||
      path.isAbsolute(relativeFile)
    ) {
      return res.status(403).send("Akses file ditolak.");
    }

    await fs.promises.unlink(filePath);

    const updatedFiles = arrayFile.filter((file) => file !== fileName);

    await db.query("UPDATE upload_document SET updated_at = $1, uploaded_files = $2 WHERE id = $3", [date, JSON.stringify(updatedFiles), id]);

    req.flash("success", "Dokumen berhasil dihapus dari server!");
    return res.redirect(`/read_data?id=${id}`);
  } catch (err) {
    console.error("Error pada route delete_file:", err);

    if (err.code === "ENOENT") {
      return res.status(404).send("File fisik tidak ditemukan.");
    }

    res.status(500).send("Terjadi kesalahan pada sistem.");
  }
});



// Update decument
app.post("/update_data", upload.fields([
  { name: "Form_Pendaftaran_API", maxCount: 1 },
  { name: "Memo_Bisnis", maxCount: 1 },
  { name: "BRD", maxCount: 1 },
  { name: "Form_Deployment", maxCount: 1 },
  { name: "Outline_SIT", maxCount: 1 },
  { name: "BA_UAT", maxCount: 1 },
  { name: "Memo_IT", maxCount: 1 },
  { name: "Surat_Permohonan_Verifikasi", maxCount: 1 },
  { name: "Surat_Kebenaran", maxCount: 1 },
  { name: "Surat_Kesesuaian", maxCount: 1 },
  { name: "Matriks_Penjelasan_SOP", maxCount: 1 },
  { name: "SOP_Penyedia", maxCount: 1 },
  { name: "24 - API Virtual Account - Inquiry - Positif", maxCount: 1 },
  { name: "24 - API Virtual Account - Inquiry - Negatif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment - Positif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment - Negatif", maxCount: 1 },
  { name: "26 - API Virtual Account - Inquiry Status - Positif", maxCount: 1 },
  { name: "26 - API Virtual Account - Inquiry Status - Negatif", maxCount: 1 },
  { name: "27 - API Virtual Account - Create VA - Positif", maxCount: 1 },
  { name: "27 - API Virtual Account - Create VA - Negatif", maxCount: 1 },
  { name: "30 - API Virtual Account - Inquiry VA - Positif", maxCount: 1 },
  { name: "30 - API Virtual Account - Inquiry VA - Negatif", maxCount: 1 },
  { name: "28 - API Virtual Account - Update VA - Positif", maxCount: 1 },
  { name: "28 - API Virtual Account - Update VA - Negatif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment VA - Positif", maxCount: 1 },
  { name: "25 - API Virtual Account - Payment VA - Negatif", maxCount: 1 },
  { name: "47 - API Generate QR MPM - Positif", maxCount: 1 },
  { name: "47 - API Generate QR MPM - Negatif", maxCount: 1 },
  { name: "51 - API Query Payment - Positif", maxCount: 1 },
  { name: "51 - API Query Payment - Negatif", maxCount: 1 },
  { name: "52 - API Payment Notification - Positif", maxCount: 1 },
  { name: "52 - API Payment Notification - Negatif", maxCount: 1 },
  { name: "BA_Uji_Fungsi", maxCount: 1 },
  { name: "Hasil_Uji_Fungsi", maxCount: 1 }
]), async (req, res) => {
  try {
    const id = req.query.id;
    if (!id || id === "") {
      return res.status(400).send("ID data tidak valid.");
    }

    if (!req.files || Object.keys(req.files).length === 0) {
        req.flash("error", "Anda belum memilih dokumen baru untuk diperbarui!");
        return res.redirect(`/read_data?id=${id}`);
      }

    const dataDb = (await db.query("SELECT * FROM upload_document WHERE id = $1", [id])).rows;
    const targetData = dataDb[0];
    const date = new Date().toLocaleString('sv-SE');

    if (!targetData) {
      return res.status(404).send("Data tidak ditemukan.");
    }

    let uploadedDocuments = [];
    if (targetData.uploaded_files) {
      try {
        uploadedDocuments = typeof targetData.uploaded_files === "string"
          ? JSON.parse(targetData.uploaded_files)
          : targetData.uploaded_files;
      } catch (e) {
        console.log("Gagal parse JSON dari DB, inisialisasi array kosong.");
        uploadedDocuments = [];
      }
    }

    if (req.files && Object.keys(req.files).length > 0) {
      const fullFolderPath = path.join(targetLocation, targetData.folder_name);

      for (const fieldName in req.files) {
        const fileObject = req.files[fieldName][0];
        const newFilenameWithExt = fileObject.filename;

        const oldFileIndex = uploadedDocuments.findIndex(file => file.startsWith(fieldName));

        if (oldFileIndex !== -1) {
          const oldFilename = uploadedDocuments[oldFileIndex];
          const oldFilePath = path.join(fullFolderPath, oldFilename);
          
          if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
          }

          uploadedDocuments[oldFileIndex] = newFilenameWithExt;
        } else {
          uploadedDocuments.push(newFilenameWithExt);
        }
      }
    }

    await db.query("UPDATE upload_document SET uploaded_files = $1, updated_at = $2 WHERE id = $3", [JSON.stringify(uploadedDocuments), date, id]);  

    req.flash("success", "Dokumen berhasil diperbarui!");
    return res.redirect("/");
    // res.redirect(`/read_data?id=${id}`);

  } catch (err) {
    console.error("Error pada rute update_data:", err);
    res.status(500).send("Terjadi kesalahan sistem saat memperbarui berkas.");
  }
});


// Download document
app.get("/download_file", async (req, res) => {
  try {
    const id = req.query.id;
    const fileName = req.query.fileName;

    if (!id || !fileName) {
      return res.status(400).send("Parameter pengunduhan berkas tidak valid.");
    }

    const safeFileName = path.basename(fileName); 

    const dataDb = (await db.query("SELECT * FROM upload_document WHERE id = $1", [id])).rows;
    const targetData = dataDb[0];

    if (!targetData) {
      return res.status(404).send("Data institusi pemilik berkas tidak ditemukan di database.");
    }

    const savedFolderName = targetData.folder_name;
    const absoluteFilePath = path.resolve(targetLocation, savedFolderName, safeFileName);

    const resolvedTargetBase = path.resolve(targetLocation);

    if (!absoluteFilePath.startsWith(resolvedTargetBase)) {
      return res.status(403).send("Akses unduhan dokumen ditolak.");
    }

    try {
      await fs.promises.access(absoluteFilePath, fs.constants.F_OK);
      res.download(absoluteFilePath);
    } catch (err) {
      res.status(404).send("Berkas fisik tidak ditemukan di dalam folder penyimpanan server.");
    }

  } catch (err) {
    console.error("Error pada download_file:", err);
    res.status(500).send("Terjadi kesalahan sistem saat memproses unduhan berkas.");
  }
});


// Delete integration
app.get("/delete", async (req, res) => {
  try{
    const id = req.query.id;

    if (typeof id === "undefined" || id === "") {
      return res.status(400).send("ID data tidak valid.");
    }

    const dataDb = (await db.query("SELECT folder_name FROM upload_document WHERE id = $1", [id])).rows;

    if(dataDb.length === 0) {
      return res.status(404).json({ message: 'Data integrasi tidak ditemukan!' });
    }

    const folderName = dataDb[0].folder_name;

    if (!folderName) {
      console.error('Folder penyimpanan tidak ditemukan:', { folderName });
      return res.status(400).json({ message: 'folderName wajib dikirim!' });

    } else {
      if (path.basename(folderName) !== folderName) {
        return res.status(400).send("Nama folder atau file tidak valid.");
      }
      
      const baseFolder = path.resolve(process.cwd(), "data", "uploaded_file");
      const folderPath = path.resolve(baseFolder, folderName);
      const relativeFolder = path.relative(baseFolder, folderPath);

      if (
        relativeFolder.startsWith("..") ||
        path.isAbsolute(relativeFolder)
      ) {
        return res.status(403).send("Akses file ditolak.");
      }

      await fs.promises.rm(folderPath, { 
        recursive: true, 
        force: true 
      });

      await db.query("DELETE FROM upload_document WHERE id = $1", [id]);

      req.flash("success", "Mitra berhasil dihapus!");
      return res.redirect("/");
    }
  } catch(err) {
    console.error("Error pada route /delete:", err);
    res.status(500).send("Terjadi kesalahan sistem pada route /delete.");
  }
})

app.use((err, req, res, next) => {
  console.error('Upload error:', err);

  const isUpdateRequest = req.path === '/update_data';

  const redirectUrl =
    isUpdateRequest && req.query.id ? `/read_data?id=${encodeURIComponent(req.query.id)}` : '/upload';

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      req.flash('error', 'Ukuran file terlalu besar! Maksimal dokumen adalah 2 MB.');
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      req.flash('error', 'Kolom unggah dokumen tidak dikenali atau jumlah file melebihi batas.');
    } else {
      req.flash('error', 'Terjadi kesalahan saat mengunggah dokumen.');
    }

    return res.redirect(redirectUrl);
  }

  if (err.message === 'Format file tidak valid! Hanya diperbolehkan PDF, Word, dan Excel.') {
    req.flash('error', 'Format file tidak didukung! Gunakan PDF, DOC, DOCX, XLS, atau XLSX.');

    return res.redirect(redirectUrl);
  }

  next(err);
});


app.listen(port, () => {
  console.log(`Server berjalan di http://localhost:${port}`);
});
