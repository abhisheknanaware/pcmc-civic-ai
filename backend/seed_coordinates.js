require('dotenv').config();
const mongoose = require('mongoose');
const Complaint = require('./models/Complaint');

async function addRandomCoordinates() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  const complaints = await Complaint.find();
  
  // Pimpri-Chinchwad center
  const [baseLat, baseLng] = require('../config/pcmc.json').corporation.mapCenter;
  
  let count = 0;
  for (let c of complaints) {
    if (!c.location || !c.location.latitude) {
      // Add random jitter between -0.05 and +0.05 degrees (approx 5km)
      const randomLat = baseLat + (Math.random() - 0.5) * 0.1;
      const randomLng = baseLng + (Math.random() - 0.5) * 0.1;
      
      c.location = {
        address: c.location?.address || 'Pimpri-Chinchwad Area',
        latitude: randomLat,
        longitude: randomLng
      };
      
      await c.save();
      count++;
    }
  }
  
  console.log(`Updated ${count} complaints with random GPS coordinates for map visualization.`);
  process.exit(0);
}

addRandomCoordinates();
