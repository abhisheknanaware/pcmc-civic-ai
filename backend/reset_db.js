require('dotenv').config();
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const Complaint = require('./models/Complaint');

cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_SECRET_KEY 
});

async function resetSystem() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB.");

    // 1. Delete all images from the Cloudinary folder 'pmc_complaints'
    console.log("Connecting to Cloudinary to wipe images...");
    const cloudinaryResponse = await cloudinary.api.delete_resources_by_prefix('pmc_complaints/');
    console.log(`Cloudinary Cleanup: Removed ${Object.keys(cloudinaryResponse.deleted).length || 0} images from the cloud.`);

    // 2. Wipe the MongoDB collection
    console.log("Wiping all complaints from MongoDB...");
    const deleteResult = await Complaint.deleteMany({});
    console.log(`MongoDB Cleanup: Deleted ${deleteResult.deletedCount} complaint records.`);

    console.log("System successfully reset to a clean state! ✨");
    process.exit(0);
  } catch (error) {
    console.error("Error resetting system:", error);
    process.exit(1);
  }
}

resetSystem();
