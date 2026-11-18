
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Load .env from the same folder as this server.js file
dotenv.config({
  path: fileURLToPath(new URL("./.env", import.meta.url)),
  override: true,
});

const app = express();
const PORT = process.env.PORT || 5000;

// Firebase Admin setup
const serviceAccount = JSON.parse(
  await readFile(
    new URL("./serviceAccountKey.json", import.meta.url),
    "utf8"
  )
);

initializeApp({
  credential: cert(serviceAccount),
});

const auth = getAuth();
const db = getFirestore();

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
  api_key: process.env.CLOUDINARY_API_KEY?.trim(),
  api_secret: process.env.CLOUDINARY_API_SECRET?.trim(),
});
console.log("Cloudinary configured cloud:", cloudinary.config().cloud_name);

console.log(
  "Server signature test:",
  cloudinary.utils.api_sign_request(
    {
      invalidate: true,
      public_id: "chemax_posts/anzvfuwguuvkgonfkctt",
      timestamp: 1794983324,
    },
    cloudinary.config().api_secret
  )
);

console.log("Cloudinary configuration:", {
  cloudNamePresent: Boolean(process.env.CLOUDINARY_CLOUD_NAME),
  apiKeyPresent: Boolean(process.env.CLOUDINARY_API_KEY),
  apiSecretPresent: Boolean(process.env.CLOUDINARY_API_SECRET),
  apiSecretLength: process.env.CLOUDINARY_API_SECRET?.trim().length || 0,
});

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
  })
);
app.use(express.json());

// Extract Cloudinary public ID from a media URL
function getPublicIdFromUrl(url) {
  if (!url) return null;

  const marker = "/upload/";
  const index = url.indexOf(marker);

  if (index === -1) return null;

  let path = url.slice(index + marker.length);

  // Remove version number, for example v123456789/
  path = path.replace(/^v\d+\//, "");

  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");

  if (lastDot > lastSlash) {
    path = path.slice(0, lastDot);
  }

  return path || null;
}

// Test backend
app.get("/", (req, res) => {
  res.send("CHEMAX Backend Server is Running!");
});

// Delete post
app.delete("/api/posts/:postId", async (req, res) => {
  console.log("DELETE REQUEST RECEIVED:", req.params.postId);
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        error: "Login required.",
      });
    }

    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;

    const postRef = db.collection("posts").doc(req.params.postId);
    const postSnapshot = await postRef.get();

    if (!postSnapshot.exists) {
      return res.status(404).json({
        error: "Post not found.",
      });
    }

    const post = postSnapshot.data();

    if (post.authorId !== userId) {
      return res.status(403).json({
        error: "You cannot delete someone else's post.",
      });
    }

    const publicId =
      post.mediaPublicId || getPublicIdFromUrl(post.mediaUrl);

    if (publicId) {
      const resourceType =
        post.mediaType === "video" ? "video" : "image";

      console.log("Deleting Cloudinary media:", {
        publicId,
        resourceType,
      });

      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        type: "upload",
        invalidate: true,
      });

      console.log("Cloudinary delete result:", result);

      if (result.result !== "ok" && result.result !== "not found") {
        throw new Error("Cloudinary media deletion failed.");
      }
    }

    await postRef.delete();

    return res.json({
      success: true,
      message: "Post deleted successfully.",
    });
  } catch (error) {
    console.error("Delete error:", error);

    return res.status(500).json({
      error: error.message || "Something went wrong.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`CHEMAX server running at http://localhost:${PORT}`);
});
