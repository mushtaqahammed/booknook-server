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

// Connect to MongoDB and prepare indexes
// - books are queried by owner (userId)
// - a user can borrow a specific book only once (compound unique index)
async function connectToDatabase() {
  await client.connect();

  try {
    await addBookCollection.createIndex({ userId: 1 });
  } catch (error) {
    console.error("Index creation failed:", error);
  }

  try {
    // Remove existing duplicate borrows so the unique index can be built.
    // Keeps the oldest record for each (bookId, userEmail) pair.
    const duplicates = await addBorrowsBook
      .aggregate([
        {
          $group: {
            _id: { bookId: "$bookId", userEmail: "$userEmail" },
            ids: { $push: "$_id" },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    for (const duplicate of duplicates) {
      const [, ...removeIds] = duplicate.ids;

      await addBorrowsBook.deleteMany({
        _id: { $in: removeIds },
      });

      console.log(
        `Removed ${removeIds.length} duplicate borrow record(s) for`,
        duplicate._id.userEmail
      );
    }

    await addBorrowsBook.createIndex(
      { bookId: 1, userEmail: 1 },
      { unique: true }
    );
  } catch (error) {
    console.error("Borrow index creation failed:", error);
  }
}

connectToDatabase().catch((error) => {
  console.error("MongoDB connection failed:", error);
  process.exit(1);
});

// Authenticated user's id from the verified JWT payload
const getUserIdFromToken = (user) => user?.sub || user?.id || null;

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


// Add Book (Protected Route)
app.post("/add-book", verifyToken, async (req, res) => {
  try {
    const data = req.body;

    // Validate required text fields
    const title = typeof data.title === "string" ? data.title.trim() : "";
    const author = typeof data.author === "string" ? data.author.trim() : "";
    const category =
      typeof data.category === "string" ? data.category.trim() : "";
    const description =
      typeof data.description === "string" ? data.description.trim() : "";

    if (!title || !author || !category || !description) {
      return res.status(400).send({
        success: false,
        message: "Title, author, category and description are required",
      });
    }

    const copies = Number(data.totalCopies ?? data.availableCopies ?? 1);

    if (!Number.isInteger(copies) || copies < 1) {
      return res.status(400).send({
        success: false,
        message: "Total copies must be at least 1",
      });
    }

    // Ownership always comes from the verified token, never from the request body
    const userId = getUserIdFromToken(req.user);
    const userEmail = req.user.email;

    if (!userId || !userEmail) {
      return res.status(401).send({
        success: false,
        message: "User information not found in token",
      });
    }

    const result = await addBookCollection.insertOne({
      title,
      author,
      category,
      description,
      image: typeof data.image === "string" ? data.image : "",
      totalCopies: copies,
      availableCopies: copies,
      userId,
      addedBy: {
        id: userId,
        name: req.user.name || "",
        email: userEmail,
      },
    });

    res.status(201).send({
      success: true,
      message: "Book added successfully!",
      result,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
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

// Get My Books (Protected Route - only the owner can read their shelf)
app.get("/my-books/:userId", verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const tokenUserId = getUserIdFromToken(req.user);

    if (userId !== tokenUserId && userId !== req.user.email) {
      return res.status(403).send({
        success: false,
        message: "You can only view your own books",
      });
    }

    // Match by user id, or by email for books added by the same account
    const result = await addBookCollection
      .find({ $or: [{ userId: tokenUserId }, { "addedBy.email": req.user.email }] })
      .toArray();

    res.send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Something went wrong",
    });
  }
});

// Update Book (Protected Route - only the owner can update)
app.put("/books/:id", verifyToken, async (req, res) => {
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
      if (data[field] !== undefined && data[field] !== "") {
        update[field] = data[field];
      }
    }

    // Changing total copies keeps availability in sync with active borrows
    if (data.totalCopies !== undefined) {
      const newTotal = Number(data.totalCopies);

      if (!Number.isInteger(newTotal) || newTotal < 1) {
        return res.status(400).send({
          message: "Total copies must be at least 1",
        });
      }

      const activeBorrows = await addBorrowsBook.countDocuments({ bookId: id });

      if (newTotal < activeBorrows) {
        return res.status(409).send({
          message: `Cannot reduce copies to ${newTotal}. ${activeBorrows} ${
            activeBorrows === 1 ? "copy is" : "copies are"
          } currently borrowed`,
        });
      }

      update.totalCopies = newTotal;
      update.availableCopies = newTotal - activeBorrows;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).send({
        message: "No valid fields provided for update",
      });
    }

    // Ownership check - the book must belong to the authenticated user
    const tokenUserId = getUserIdFromToken(req.user);

    const book = await addBookCollection.findOne({ _id: new ObjectId(id) });

    if (!book) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    const isOwner =
      tokenUserId !== null &&
      (book.userId === tokenUserId ||
        book.addedBy?.id === tokenUserId ||
        book.addedBy?.email === req.user.email);

    if (!isOwner) {
      return res.status(403).send({
        message: "You can only update your own books",
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

// Delete Book (Protected Route - only the owner can delete)
app.delete("/books/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid Book ID",
      });
    }

    // Ownership check - the book must belong to the authenticated user
    const tokenUserId = getUserIdFromToken(req.user);

    const book = await addBookCollection.findOne({ _id: new ObjectId(id) });

    if (!book) {
      return res.status(404).send({
        message: "Book not found",
      });
    }

    const isOwner =
      tokenUserId !== null &&
      (book.userId === tokenUserId ||
        book.addedBy?.id === tokenUserId ||
        book.addedBy?.email === req.user.email);

    if (!isOwner) {
      return res.status(403).send({
        message: "You can only delete your own books",
      });
    }

    // Do not allow deleting a book that still has active borrow records
    const activeBorrows = await addBorrowsBook.countDocuments({ bookId: id });

    if (activeBorrows > 0) {
      return res.status(409).send({
        message: "This book has borrowed copies and cannot be deleted yet",
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

app.post("/borrows", verifyToken, async (req, res) => {
  try {
    const data = req.body;
    const userEmail = req.user.email;

    if (!userEmail) {
      return res.status(401).send({
        success: false,
        message: "User email not found in token",
      });
    }

    if (!ObjectId.isValid(data.bookId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid Book ID",
      });
    }

    // A return date is required when borrowing
    if (!data.returnDate) {
      return res.status(400).send({
        success: false,
        message: "Return date is required",
      });
    }

    const book = await addBookCollection.findOne({
      _id: new ObjectId(data.bookId),
    });

    if (!book) {
      return res.status(404).send({
        success: false,
        message: "Book not found",
      });
    }

    // Older books created before this feature may not have the field yet
    if (typeof book.availableCopies !== "number") {
      await addBookCollection.updateOne(
        { _id: book._id },
        { $set: { availableCopies: 1 } }
      );

      book.availableCopies = 1;
    }

    // Check whether the user already borrowed this book
    const alreadyBorrowed = await addBorrowsBook.findOne({
      bookId: data.bookId,
      userEmail,
    });

    if (alreadyBorrowed) {
      return res.status(409).send({
        success: false,
        message: "You have already borrowed this book!",
      });
    }

    // Decrease available copies only if at least one copy remains
    const bookUpdate = await addBookCollection.updateOne(
      {
        _id: new ObjectId(data.bookId),
        availableCopies: { $gt: 0 },
      },
      {
        $inc: { availableCopies: -1 },
      }
    );

    if (bookUpdate.matchedCount === 0) {
      return res.status(409).send({
        success: false,
        message: "No copies of this book are available!",
      });
    }

    // Save borrow information
    const borrowData = {
      bookId: data.bookId,
      bookTitle: data.bookTitle,
      bookImage: data.bookImage,
      userName: req.user.name || data.userName || "",
      userEmail,
      borrowDate: data.borrowDate || new Date().toISOString(),
      returnDate: data.returnDate,
    };

    try {
      const result = await addBorrowsBook.insertOne(borrowData);

      res.status(201).send({
        success: true,
        message: "Book borrowed successfully!",
        result,
      });
    } catch (insertError) {
      // Unique index catches a double-borrow race from parallel requests
      if (insertError?.code === 11000) {
        return res.status(409).send({
          success: false,
          message: "You have already borrowed this book!",
        });
      }

      // Restore available copy if borrow record could not be saved
      await addBookCollection.updateOne(
        { _id: new ObjectId(data.bookId) },
        { $inc: { availableCopies: 1 } }
      );

      throw insertError;
    }
  } catch (error) {
    console.error(error);
    res.status(500).send({
      success: false,
      message: "Something went wrong",
    });
  }
});
// Get Borrowed Books

app.get("/borrows", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    if (!userEmail) {
      return res.status(401).send({
        success: false,
        message: "User email not found in token",
      });
    }

    const result = await addBorrowsBook
      .find({ userEmail })
      .sort({ _id: -1 })
      .toArray();

    res.status(200).send(result);
  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
      message: "Something went wrong",
    });
  }
});

// Return Book (Delete a Borrow Record)
app.delete("/borrows/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user.email;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid Borrow ID",
      });
    }

    if (!userEmail) {
      return res.status(401).send({
        success: false,
        message: "User email not found in token",
      });
    }

    // Find borrow record belonging to logged-in user
    const borrow = await addBorrowsBook.findOne({
      _id: new ObjectId(id),
      userEmail,
    });

    if (!borrow) {
      return res.status(404).send({
        success: false,
        message: "Borrow record not found",
      });
    }

    if (!ObjectId.isValid(borrow.bookId)) {
      return res.status(400).send({
        success: false,
        message: "Invalid Book ID in borrow record",
      });
    }

    // Increase available copies
    const bookUpdate = await addBookCollection.updateOne(
      { _id: new ObjectId(borrow.bookId) },
      { $inc: { availableCopies: 1 } }
    );

    if (bookUpdate.matchedCount === 0) {
      return res.status(404).send({
        success: false,
        message: "Book not found",
      });
    }

    // Delete borrow record
    await addBorrowsBook.deleteOne({
      _id: new ObjectId(id),
      userEmail,
    });

    res.status(200).send({
      success: true,
      message: "Book returned successfully!",
    });
  } catch (error) {
    console.error(error);

    res.status(500).send({
      success: false,
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
