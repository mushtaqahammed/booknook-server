import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { jwtVerify, createRemoteJWKSet } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;

// MongoDB connection
const client = new MongoClient(process.env.MONGODB_URL);

app.use(cors());
app.use(express.json());

// MongoDB collections
const db = client.db("booknook");

const addBookCollection = db.collection("addbook");
const addBorrowsBook = db.collection("borrows");

// JWT Public Key
const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

// Verify JWT Middleware
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check authorization header
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).send({
        success: false,
        message: "Unauthorized! Token missing.",
      });
    }

    // Extract JWT token
    const token = authHeader.split(" ")[1];

    // Verify JWT token
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${process.env.CLIENT_URL}`,
      audience: `${process.env.CLIENT_URL}`,
    });

    // Store user information
    req.user = payload;

    console.log("User verified successfully:", payload.email);

    next();
  } catch (error) {
    console.error("JWT verification failed:", error);

    return res.status(401).send({
      success: false,
      message: "Invalid or expired token!",
    });
  }
};

// Root API
app.get("/", (req, res) => {
  res.send({
    message: "Server is running fine!",
  });
});

// Add Book
app.post("/add-book", verifyToken, async (req, res) => {
  try {
    const data = req.body;

    const result = await addBookCollection.insertOne(data);

    res.status(201).send({
      success: true,
      message: "Book added successfully!",
      result,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Get All Books
app.get("/books", async (req, res) => {
  try {
    const result = await addBookCollection.find().toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Get Single Book - Protected Route
app.get("/books/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid Book ID",
      });
    }

    const result = await addBookCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({
        success: false,
        message: "Book not found",
      });
    }

    res.status(200).send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Get My Books
app.get("/my-books/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await addBookCollection.find({ userId }).toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Update Book
app.put("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Book ID",
      });
    }

    const data = req.body;

    const allowedFields = [
      "title",
      "author",
      "category",
      "description",
      "image",
      "publishYear",
    ];

    const update = {};

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        update[field] = data[field];
      }
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).send({
        message: "No valid fields provided for update",
      });
    }

    const result = await addBookCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: update },
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    const updatedBook = await addBookCollection.findOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: "Book updated successfully!",
      data: updatedBook,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Delete Book
app.delete("/books/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Book ID",
      });
    }

    const result = await addBookCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    res.send({
      success: true,
      message: "Book deleted successfully!",
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Borrow Book
app.post("/borrows", async (req, res) => {
  try {
    const data = req.body;

    const alreadyBorrowed = await addBorrowsBook.findOne({
      bookId: data.bookId,
      userEmail: data.userEmail,
    });

    if (alreadyBorrowed) {
      return res.status(409).send({
        message: "You have already borrowed this book!",
      });
    }

    const result = await addBorrowsBook.insertOne(data);

    res.status(201).send({
      success: true,
      message: "Book borrowed successfully!",
      result,
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Get Borrowed Books
app.get("/borrows", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).send({
        message: "User email is required",
      });
    }

    const result = await addBorrowsBook.find({ userEmail: email }).toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// New Arrivals
app.get("/new-arrivals", async (req, res) => {
  try {
    const books = await addBookCollection
      .find()
      .sort({ _id: -1 })
      .limit(6)
      .toArray();

    res.send(books);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});

export default app;
