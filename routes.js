const express = require("express");

const {sendOTPEmail} = require('./mailer');
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsPromises = fs.promises;
const sendNotifications = require('./messanging');
const sharp = require("sharp");


function generateUniqueStudentId() {
  const now = new Date();

  const year = now.getFullYear();
  const month = (`0${now.getMonth() + 1}`).slice(-2);
  const day = (`0${now.getDate()}`).slice(-2);
  const hours = (`0${now.getHours()}`).slice(-2);
  const minutes = (`0${now.getMinutes()}`).slice(-2);
  const seconds = (`0${now.getSeconds()}`).slice(-2);

  const timestamp = `${year}${month}${day}${hours}${minutes}${seconds}`;
  const randomSix = Math.floor(100000 + Math.random() * 900000); // ensures 6 digits

  return `${timestamp}${randomSix}`;
}

// Ensure uploads/students directory exists
const uploadDir = path.join(__dirname, "uploads", "students");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Multer for file uploads
const storage = multer.memoryStorage(); // No destination or filename here
const upload = multer({ storage });
module.exports = function (db, admin) {
  // Sample GET route
  router.get("/", (req, res) => {
    res.write("Welcome to the API!");
    res.end();
  }); // Sample POST route

  

  router.post('/auth/register', async (req, res) => {
    const { email_phone, verified, role,token } = req.body;

    // 1. Validate inputs
    if (!email_phone || typeof verified !== 'boolean' || !role || !token) { // Added role validation
      return res.status(400).json({ error: 'Missing or invalid fields' });
    }
    console.log(token);
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email_phone);
    const isPhone = /^\d{10,15}$/.test(email_phone); // basic mobile check

    // Validate if email_phone is actually an email or a phone
    if (!isEmail && !isPhone) {
        return res.status(400).json({ error: 'Invalid email or phone number format' });
    }

    const checkQuery = `SELECT * FROM auth WHERE email_phone = ? LIMIT 1`;
    db.query(checkQuery, [email_phone], async (err, results) => {
      if (err) {
        console.error('DB error during select:', err);
        return res.status(500).json({ error: 'Database lookup failed' });
      }

      // === Case 1: USER EXISTS ===
      if (results.length > 0) {
        const user = results[0];

        // NEW LOGIC: Check if user exists with a different role
        if (user.role && user.role !== role) {
          return res.status(409).json({ // 409 Conflict is appropriate here
            status: 'role_conflict',
            message: `User with this ${isEmail ? 'email' : 'phone number'} already exists with a different role.`,
          });
        }

        // Mobile handling (existing logic)
        if (!isEmail) {
          if (user.verified) {
            // Verified mobile
            const updateTimeQuery = `UPDATE auth SET dateandtime = CURRENT_TIMESTAMP, token = ? WHERE email_phone = ?`;
            db.query(updateTimeQuery, [token, email_phone]);
            return res.status(200).json({
              status: 'mobile_verified',
              userid: user.userid,
              mobile: user.email_phone,
              role: user.role,
              message: 'Mobile already verified',
            });
          } else {
            // Not verified mobile
            return res.status(403).json({
              status: 'mobile_unverified',
              message: 'Phone number not verified. Please contact support.',
            });
          }
        }

        // Email handling (existing logic)
        if (isEmail) {
          const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
          const updateQuery = `
            UPDATE auth SET otp = ?, dateandtime = CURRENT_TIMESTAMP, token = ? WHERE email_phone = ?
          `;
          db.query(updateQuery, [newOtp, token, email_phone], async (updateErr) => {
            if (updateErr) {
              console.error('DB update error:', updateErr);
              return res.status(500).json({ error: 'Failed to update OTP' });
            }

            try {
              await sendOTPEmail(email_phone, newOtp);
              return res.status(200).json({
                status: 'otp_resent',
                message: `OTP sent to ${email_phone}`,
                userid: user.userid,
              });
            } catch (mailErr) {
              console.error('Email sending failed:', mailErr);
              return res.status(500).json({ error: 'Failed to send OTP email' });
            }
          });
          return;
        }

        // User exists and no further action needed (if roles match and other conditions don't apply)
        return res.status(200).json({
          status: 'user_exists',
          message: 'User already exists and is up to date',
          // Optionally include existing user details if roles match
          userid: user.userid,
          role: user.role, 
          mobile: user.email_phone,
        });
      }

      // === Case 2: USER DOESN’T EXIST ===
      const otp = (!verified && isEmail)
        ? Math.floor(100000 + Math.random() * 900000).toString()
        : null;

      const insertQuery = `
        INSERT INTO auth (email_phone, otp, verified, role,token)
        VALUES (?, ?, ?, ?, ?)
      `;
      // Ensure 'role' is passed correctly for new user insertion
      db.query(insertQuery, [email_phone, otp, verified ? 1 : 0, role, token], async (insertErr, result) => {
        if (insertErr) {
          console.error('Insert error:', insertErr);
          return res.status(500).json({ error: 'DB insert failed' });
        }

        const userid = result.insertId;

        if (!verified && isEmail) {
          try {
            await sendOTPEmail(email_phone, otp);
            return res.status(200).json({
              status: 'otp_sent_new',
              userid,
              message: `OTP sent to ${email_phone}`
            });
          } catch (mailErr) {
            console.error('Email send failed:', mailErr);
            return res.status(500).json({ error: 'Failed to send OTP email' });
          }
        }

        return res.status(200).json({
          status: 'user_inserted',
          userid,
          message: 'New user added'
        });
      });
    });
  });

router.post('/auth/verify-otp', async (req, res) => {
  const { email_phone, otp } = req.body;

  if (!email_phone || !otp) {
    return res.status(400).json({ error: 'Email/Phone and OTP are required' });
  }

  const checkQuery = `SELECT * FROM auth WHERE email_phone = ? LIMIT 1`;
  db.query(checkQuery, [email_phone], (err, results) => {
    if (err) {
      console.error('DB error during verification lookup:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ status: 'user_not_found', message: 'No user found' });
    }

    const user = results[0];

    if (user.otp !== otp) {
      return res.status(401).json({ status: 'invalid_otp', message: 'Invalid OTP' });
    }

    // OTP is correct, update verified status
    const updateQuery = `UPDATE auth SET verified = 1, dateandtime = CURRENT_TIMESTAMP WHERE email_phone = ?`;

    db.query(updateQuery, [email_phone], (updateErr) => {
      if (updateErr) {
        console.error('DB error during update:', updateErr);
        return res.status(500).json({ error: 'Failed to verify user' });
      }

      return res.status(200).json({
        status: 'verified',
        userid: user.userid,
        mobile: user.email_phone,
        role: user.role,
        message: 'OTP verified successfully'
      });
    });
  });
});

router.post('/parent/check', (req, res) => {
    const { email_mobile } = req.body;

    if (!email_mobile) {
      return res.status(400).json({ error: 'email_mobile is required' });
    }

    const query = `SELECT * FROM parents WHERE email_mobile = ? LIMIT 1`;
    db.query(query, [email_mobile], (err, results) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length > 0) {
        return res.status(200).json({
          exists: true,
          parent: results[0],
          message: 'Parent found',
        });
      } else {
        return res.status(200).json({
          exists: false,
          message: 'Parent not found',
        });
      }
    });
  });



router.post('/school/check', (req, res) => {
  const { email_mobile } = req.body;

  if (!email_mobile) {
    return res.status(400).json({ error: 'email_mobile is required' });
  }

  const query = `SELECT * FROM schools WHERE email_mobile = ? LIMIT 1`;

  db.query(query, [email_mobile], (err, results) => {
    if (err) {
      console.error('DB error during school check:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length > 0) {
      return res.status(200).json({
        exists: true,
        school: results[0],
        message: 'School found',
      });
    } else {
      return res.status(200).json({
        exists: false,
        message: 'School not found',
      });
    }
  });
});

router.post('/school/register', (req, res) => {
  const {
    name,
    email_mobile,
    website,
    address,
    location
  } = req.body;

  if (!name || !email_mobile) {
    return res.status(400).json({ error: 'Missing required fields: name and email_mobile' });
  }

  // Generate custom 6-digit school_code with date prefix
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(8, 14); // e.g., 151530 (HHMMSS)
  const randomDigits = Math.floor(100000 + Math.random() * 900000).toString();
  const schoolCode = `SCH${timestamp}${randomDigits.slice(0, 3)}`; // SCH + time + 3 random digits

  const insertQuery = `
    INSERT INTO schools (schoolid, name, email_mobile, website, address, location)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  db.query(insertQuery, [schoolCode, name, email_mobile, website, address, location], (err, result) => {
    if (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        console.error('Duplicate entry for email_mobile:', email_mobile);
        return res.status(409).json({ error: 'Email or mobile already registered' });
      }

      console.error('Error inserting school:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    console.log('✅ New school registered with ID:', result.insertId);
    res.status(200).json({
      message: 'School registered successfully',
      schoolid: result.insertId,
      school_code: schoolCode
    });
  });
});

const generateBusId = () => {
  const now = new Date();
  const datePart = now.toISOString().replace(/[-:TZ]/g, '').slice(8, 14); // HHMMSS
  const randomPart = Math.floor(100 + Math.random() * 900); // 3-digit random
  return `BUS${datePart}${randomPart}`; // e.g., BUS154530123
};

router.post('/buses/add', (req, res) => {
  const { busno, schoolid, capacity, busdescription } = req.body;

  if (!busno || !schoolid) {
    return res.status(400).json({ error: 'busno and schoolid are required' });
  }

  const busid = generateBusId();

  const insertQuery = `
    INSERT INTO buses (busid, busno, schoolid, capacity, busdescription)
    VALUES (?, ?, ?, ?, ?)
  `;

  db.query(insertQuery, [busid, busno, schoolid, capacity || 40, busdescription || null], (err, result) => {
    if (err) {
      console.error('Error adding bus:', err);
      return res.status(500).json({ error: 'Failed to add bus' });
    }

    console.log('Bus added:', busid);
    return res.status(200).json({ message: 'Bus added successfully', busid });
  });
});



router.get('/buses/:schoolid', (req, res) => {
  const { schoolid } = req.params;

  if (!schoolid) {
    return res.status(400).json({ error: 'schoolid is required' });
  }

  const query = `SELECT * FROM buses WHERE schoolid = ?`;

  db.query(query, [schoolid], (err, results) => {
    if (err) {
      console.error('Error fetching buses:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({
      buses: results,
      message: results.length ? 'Buses fetched successfully' : 'No buses found'
    });
  });
});



router.put('/buses/:busid', (req, res) => {
  const { busid } = req.params;
  const { busno, schoolid, capacity, busdescription } = req.body;

  if (!busid) {
    return res.status(400).json({ error: 'busid is required' });
  }

  const updateQuery = `
    UPDATE buses
    SET busno = ?, schoolid = ?, capacity = ?, busdescription = ?
    WHERE busid = ?
  `;

  db.query(updateQuery, [busno, schoolid, capacity, busdescription, busid], (err, result) => {
    if (err) {
      console.error('Error updating bus:', err);
      return res.status(500).json({ error: 'Failed to update bus' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Bus not found' });
    }

    return res.status(200).json({ message: 'Bus updated successfully' });
  });
});


router.delete('/buses/:busid', (req, res) => {
  const { busid } = req.params;

  if (!busid) {
    return res.status(400).json({ error: 'busid is required' });
  }

  const deleteQuery = `DELETE FROM buses WHERE busid = ?`;

  db.query(deleteQuery, [busid], (err, result) => {
    if (err) {
      console.error('Error deleting bus:', err);
      return res.status(500).json({ error: 'Failed to delete bus' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Bus not found' });
    }

    return res.status(200).json({ message: 'Bus deleted successfully' });
  });
});



router.get('/schools', (req, res) => {
  const getQuery = `SELECT * FROM schools`;

  db.query(getQuery, (err, results) => {
    if (err) {
      console.error('Error fetching schools:', err);
      return res.status(500).json({ error: 'Failed to fetch schools' });
    }

    return res.status(200).json({ schools: results });
  });
});


router.get('/students/:email_mobile', (req, res) => {
  console.log('Fetching students for parent:', req.params.email_mobile);
  const { email_mobile } = req.params;

  if (!email_mobile) {
    return res.status(400).json({ error: 'email_mobile is required' });
  }

  const query = `SELECT * FROM students WHERE parentid = ?`;

  db.query(query, [email_mobile], (err, results) => {
    if (err) {
      console.error('Error fetching students:', err);
      return res.status(500).json({ error: 'Failed to fetch students' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'No students found for this parent' });
    }

    return res.status(200).json({ students: results });
  });
});

// DELETE /students/:student_id/:parentid
router.delete('/students/:student_id/:parentid', (req, res) => {
  const { student_id, parentid } = req.params;

  if (!student_id || !parentid) {
    return res.status(400).json({ error: 'student_id and parentid are required' });
  }

  const deleteQuery = `DELETE FROM students WHERE student_id = ? AND parentid = ?`;

  db.query(deleteQuery, [student_id, parentid], (err, result) => {
    if (err) {
      console.error('Error deleting student:', err);
      return res.status(500).json({ error: 'Failed to delete student' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Student not found or parentid mismatch' });
    }

    return res.status(200).json({ message: 'Student deleted successfully' });
  });
});


router.post('/students/unverified', (req, res) => {
  const { school_id } = req.body;

  if (!school_id) {
    return res.status(400).json({ error: 'school_id is required' });
  }

  const query = `SELECT * FROM students WHERE school_id = ? AND verified = 1`;

  db.query(query, [school_id], (err, results) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({
      count: results.length,
      students: results,
      message: results.length > 0 ? 'Unverified students found' : 'No unverified students found',
    });
  });
});


router.post('/buses/by-school', (req, res) => {
  const { schoolid } = req.body;

  if (!schoolid) {
    return res.status(400).json({ error: 'schoolid is required' });
  }

  const query = `SELECT * FROM buses WHERE schoolid = ?`;

  db.query(query, [schoolid], (err, results) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({
      count: results.length,
      buses: results,
      message: results.length > 0 ? 'Buses found' : 'No buses found for this school',
    });
  });
});



router.post('/students/update-bus', (req, res) => {
  const { student_id, morningbus, eveningbus } = req.body;

  if (!student_id) {
    return res.status(400).json({ error: 'student_id is required' });
  }

  const query = `
    UPDATE students
    SET verified = 0, morningbus = ?, eveningbus = ?
    WHERE student_id = ?
  `;

  db.query(query, [morningbus || null, eveningbus || null, student_id], (err, result) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Failed to update student' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.status(200).json({
      message: 'Student updated successfully',
      updated_fields: {
        verified: 0,
        morningbus,
        eveningbus
      }
    });
  });
});




router.post('/students/add', upload.single('photo'), async (req, res) => {
    console.log('welcome');
    try {
        console.log('📥 Received request to add student');
        console.log('Request body:', req.body);
        console.log('Uploaded file:', req.file?.originalname);

        const {
            name,
            parentid,
            date_of_birth,
            address,
            home_coordinates,
            school_id,
            school_name,
            morning_pick,
            morning_drop,
            evening_pick,
            evening_drop,
            verified
        } = req.body;

        if (!name || !date_of_birth || !school_id) {
            console.warn('⚠️ Missing required fields:', { name, date_of_birth, school_id });
            return res.status(400).json({ error: 'Missing required fields (name, date_of_birth, school_id)' });
        }

        let compressedImagePath = null;

        if (req.file && req.file.buffer) {
            try {
                const filename = `student_${Date.now()}.jpg`;
                const tempDir = path.join(__dirname, "uploads", "temp");
                const finalUploadDir = path.join(__dirname, "uploads", "students"); // Renamed for clarity
                const tempPath = path.join(tempDir, filename);
                const finalPath = path.join(finalUploadDir, filename);

                // Ensure directories exist (synchronous is OK for startup, but better to check once at app start)
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                if (!fs.existsSync(finalUploadDir)) {
                    fs.mkdirSync(finalUploadDir, { recursive: true });
                }

                console.log("🗜️ Compressing image to temp...");

                await sharp(req.file.buffer)
                    .resize({ width: 800 })
                    .jpeg({ quality: 70 })
                    .toFile(tempPath);

                const { size: initialSize } = await fsPromises.stat(tempPath); // Use async stat
                console.log(`📏 Image size after first compression: ${(initialSize / 1024).toFixed(2)} KB`);

                if (initialSize > 100 * 1024) {
                    console.log("🔁 Re-compressing due to large size...");
                    await sharp(tempPath)
                        .jpeg({ quality: 50 })
                        .toFile(finalPath);
                    await fsPromises.unlink(tempPath); // Use async unlink
                    console.log("🧹 Temp file deleted after recompression.");
                } else {
                    await fsPromises.rename(tempPath, finalPath); // Use async rename
                    console.log("📦 Moved compressed image to final path.");
                }

                compressedImagePath = `/uploads/students/${filename}`;
                console.log("✅ Final image path:", compressedImagePath);
            } catch (imgErr) {
                console.error("❌ Error processing image:", imgErr);
                return res.status(500).json({ error: 'Image processing failed' });
            }
        }

        const id = generateUniqueStudentId();
        console.log("🆔 Generated student ID:", id);

        const insertQuery = `
            INSERT INTO students (student_id, parentid,
            name, date_of_birth, address, home_coordinates,
            school_id, school_name,
            morning_pick, morning_drop, evening_pick, evening_drop,
            photo, verified
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `;

        const values = [
            id, parentid,
            name, date_of_birth, address, home_coordinates,
            school_id, school_name,
            morning_pick, morning_drop, evening_pick, evening_drop,
            compressedImagePath, verified ? 1 : 0
        ];

        console.log("📤 Inserting student into database...");

        // Wrap db.query in a Promise for async/await
        await new Promise((resolve, reject) => {
            db.query(insertQuery, values, (err, result) => {
                if (err) {
                    console.error('❌ Error inserting student into DB:', err);
                    return reject(err);
                }
                console.log('✅ Student added with DB insert ID:', result.insertId);
                res.status(200).json({
                    message: 'Student added successfully',
                    student_id: result.insertId,
                    photo_url: compressedImagePath
                });
                resolve();
            });
        });

    } catch (error) {
        console.error('🔥 Unexpected error in /students/add:', error);
        // Ensure only one response is sent
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});



router.post('/students/all', (req, res) => {
  const { school_id } = req.body;

  if (!school_id) {
    return res.status(400).json({ error: 'school_id is required' });
  }

  const query = `SELECT * FROM students WHERE school_id = ? AND verified = 0`;

  db.query(query, [school_id], (err, results) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({
      count: results.length,
      students: results,
      message: results.length > 0 ? 'Students found' : 'No students found for this school',
    });
  });
});

// route: GET /drivers/unverified/:school_id
router.get('/drivers/unverified/:school_id', (req, res) => {
  const { school_id } = req.params;

  if (!school_id) {
    return res.status(400).json({ error: 'school_id is required' });
  }

  const query = `
    SELECT * FROM drivers
    WHERE school_id = ? AND is_verified = 0
  `;

  db.query(query, [school_id], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Failed to fetch unverified drivers' });
    }

    res.status(200).json({
      message: 'Unverified drivers fetched successfully',
      drivers: results
    });
  });
});


router.post('/drivers/update-bus', (req, res) => {
  const { driver_id, morning_bus, evening_bus } = req.body;

  if (!driver_id) {
    return res.status(400).json({ error: 'driver_id is required' });
  }

  const query = `
    UPDATE drivers
    SET morning_bus = ?, evening_bus = ?, is_verified = 1
    WHERE driver_id = ?
  `;

  db.query(query, [morning_bus || null, evening_bus || null, driver_id], (err, result) => {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ error: 'Failed to update driver' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    res.status(200).json({
      message: '✅ Driver bus info updated successfully',
      updated_fields: {
        is_verified: 0,
        morning_bus,
        evening_bus
      }
    });
  });
});


router.post('/students/unverify', (req, res) => {
  console.log('Received request to unverify student');
  const { student_id } = req.body;

  if (!student_id) {
    return res.status(400).json({ error: 'student_id is required' });
  }

  const query = `UPDATE students SET verified = 1 WHERE student_id = ?`;

  db.query(query, [student_id], (err, result) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Student not found or already unverified' });
    }

    return res.status(200).json({ message: 'Student marked as unverified successfully' });
  });
});

router.post('/drivers/check', (req, res) => {
  const { email_phone } = req.body;

  if (!email_phone) {
    return res.status(400).json({ error: 'email_phone is required' });
  }

  const query = `SELECT * FROM drivers WHERE email_phone = ? LIMIT 1`;

  db.query(query, [email_phone], (err, results) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ exists: false, message: 'Driver not found' });
    }

    return res.status(200).json({
      exists: true,
      driver: results[0],
      message: 'Driver found',
    });
  });
});

router.post('/drivers/register', upload.single('dl_photo'), (req, res) => {
  const {
    name,
    date_of_birth,
    dl_number,
    email_phone,
    school_id
  } = req.body;

  if (!name || !date_of_birth || !dl_number || !email_phone || !school_id || !req.file) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const driver_id = `driver_${Date.now()}`;
  const dl_photo = req.file.path;

  const query = `
    INSERT INTO drivers (
      driver_id,
      name,
      date_of_birth,
      dl_number,
      dl_photo,
      email_phone,
      is_on_road,
      morning_bus,
      evening_bus,
      current_location,
      is_verified,
      school_id
    ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, 0, ?)
  `;

  db.query(query, [
    driver_id,
    name,
    date_of_birth,
    dl_number,
    dl_photo,
    email_phone,
    school_id
  ], (err, result) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: 'DB error' });
    }
    return res.status(200).json({ message: 'Driver registered successfully', driver_id });
  });
});



// tacking routes
router.post('/drivers/update-location', (req, res) => {
  const { driver_id, current_location } = req.body;

  if (!driver_id || !current_location) {
    return res.status(400).json({ error: 'driver_id and current_location are required' });
  }

  const query = `
    UPDATE drivers
    SET current_location = ? , is_on_road = 1
    WHERE driver_id = ?
  `;

  db.query(query, [current_location, driver_id], (err, result) => {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ error: 'Failed to update location' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    res.status(200).json({
      message: '✅ Driver location updated successfully',
      updated_fields: {
        driver_id,
        current_location
      }
    });
  });
});

// New API endpoint for ending the trip
router.post('/drivers/end-trip', (req, res) => {
    const { driver_id } = req.body;

    if (!driver_id) {
      return res.status(400).json({ error: 'driver_id is required' });
    }

    // First: Update driver's trip status
    const updateQuery = `
      UPDATE drivers
      SET is_on_road = 0
      WHERE driver_id = ?
    `;

    db.query(updateQuery, [driver_id], (err, result) => {
      if (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({ error: 'Failed to end trip' });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'Driver not found' });
      }

      // Send response immediately (non-blocking)
      res.status(200).json({
        message: '✅ Driver trip ended successfully (is_on_road set to 0)',
        updated_fields: {
          driver_id,
          is_on_road: 0
        }
      });

      // Now: Get tokens of parents whose kids are in that driver's bus
      const getBusQuery = `SELECT morning_bus FROM drivers WHERE driver_id = ?`;

      db.query(getBusQuery, [driver_id], (err, busResult) => {
        if (err || busResult.length === 0) {
          console.error('❌ Failed to get bus info:', err || 'Driver not found');
          return;
        }

        const busId = busResult[0].morning_bus;

        // Step 1: Get parentid from students using morningbus
        const getParentIdsQuery = `
          SELECT DISTINCT parentid FROM students
          WHERE morningbus = ?
        `;

        db.query(getParentIdsQuery, [busId], (err, studentResult) => {
          if (err || studentResult.length === 0) {
            console.error('❌ No students found:', err || 'No parent IDs');
            return;
          }

          const parentIds = studentResult.map(row => row.parentid);

          if (parentIds.length === 0) return;

          // Step 2: Get tokens from auth where email_phone in parentIds
          const getTokensQuery = `
            SELECT token FROM auth
            WHERE email_phone IN (?) AND token IS NOT NULL
          `;

          db.query(getTokensQuery, [parentIds], (err, tokenResult) => {
            if (err || tokenResult.length === 0) {
              console.error('❌ No tokens found:', err || 'Empty token list');
              return;
            }

            const tokens = tokenResult.map(row => row.token).filter(Boolean);

            if (tokens.length === 0) return;

            // Step 3: Send notification in background
            sendNotifications(admin, tokens, "Trip Ended", "Your child's bus trip has ended.")
              .then(result => {
                console.log('📢 Notification result:', result);
              })
              .catch(err => {
                console.error('❌ Failed to send notifications:', err);
              });
          });
        });
      });
    });
  });

router.post('/drivers/students-morning-bus', (req, res) => {
  const { driver_id } = req.body;

  if (!driver_id) {
    return res.status(400).json({ error: 'driver_id is required' });
  }

  // Step 1: Get driver's morning_bus ID
  const getBusQuery = `
    SELECT morning_bus FROM drivers WHERE driver_id = ?
  `;

  db.query(getBusQuery, [driver_id], (err, results) => {
    if (err) {
      console.error('❌ Error fetching driver data:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const morningBusId = results[0].morning_bus;

    if (!morningBusId) {
      return res.status(400).json({ error: 'Driver has no assigned morning_bus' });
    }

    // Step 2: Find all students with same morningbus
    const getStudentsQuery = `
      SELECT * FROM students WHERE morningbus = ?
    `;

    db.query(getStudentsQuery, [morningBusId], (err, studentResults) => {
      if (err) {
        console.error('❌ Error fetching students:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      res.status(200).json({
        message: `✅ Found ${studentResults.length} students with morningbus: ${morningBusId}`,
        students: studentResults
      });
    });
  });
});



router.post('/drivers/students-evening-bus', (req, res) => {
  const { driver_id } = req.body;

  if (!driver_id) {
    return res.status(400).json({ error: 'driver_id is required' });
  }

  const getBusQuery = `
    SELECT evening_bus FROM drivers WHERE driver_id = ?
  `;

  db.query(getBusQuery, [driver_id], (err, results) => {
    if (err) {
      console.error('❌ Error fetching driver:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    const eveningBusId = results[0].evening_bus;

    if (!eveningBusId) {
      return res.status(400).json({ error: 'Driver has no assigned evening_bus' });
    }

    const getStudentsQuery = `
      SELECT * FROM students WHERE eveningbus = ?
    `;

    db.query(getStudentsQuery, [eveningBusId], (err, studentResults) => {
      if (err) {
        console.error('❌ Error fetching students:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      res.status(200).json({
        message: `✅ Found ${studentResults.length} students with eveningbus: ${eveningBusId}`,
        students: studentResults
      });
    });
  });
});



  return router;
};
