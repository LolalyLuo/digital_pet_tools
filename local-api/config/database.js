import { createClient } from "@supabase/supabase-js";

let supabase = null;
let prodSupabase = null;
let instameshopSupabase = null;
let dragonSupabase = null;

// Initialize Supabase clients (called after dotenv.config())
export function initializeClients() {
  console.log("🔧 Initializing Supabase client...");
  console.log("📍 Supabase URL:", process.env.SUPABASE_URL);
  console.log(
    "🔑 Service Role Key (first 20 chars):",
    process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 20) + "..."
  );

  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Production database client for training sample generation
  prodSupabase = createClient(
    process.env.PROD_SUPABASE_URL,
    process.env.PROD_SUPABASE_SERVICE_ROLE_KEY
  );

  instameshopSupabase = createClient(
    process.env.INSTAME_SHOP_SUPABASE_URL,
    process.env.INSTAME_SHOP_SERVICE_ROLE_KEY
  );

  if (process.env.DRAGON_SUPABASE_URL && process.env.DRAGON_SUPABASE_SERVICE_ROLE_KEY) {
    dragonSupabase = createClient(
      process.env.DRAGON_SUPABASE_URL,
      process.env.DRAGON_SUPABASE_SERVICE_ROLE_KEY
    );
    console.log("✅ Dragon Supabase client initialized");
  }

  console.log("✅ Supabase client initialized");
  console.log("✅ Production Supabase client initialized");
  console.log("✅ InstaMeShop Supabase client initialized");
}

// Getter functions to access the clients
export function getSupabase() {
  if (!supabase) {
    throw new Error("Supabase client not initialized. Call initializeClients() first.");
  }
  return supabase;
}

export function getProdSupabase() {
  if (!prodSupabase) {
    throw new Error("Production Supabase client not initialized. Call initializeClients() first.");
  }
  return prodSupabase;
}

export function getInstameshopSupabase() {
  if (!instameshopSupabase) {
    throw new Error("InstaMeShop Supabase client not initialized. Call initializeClients() first.");
  }
  return instameshopSupabase;
}

export function getDragonSupabase() {
  if (!dragonSupabase) {
    throw new Error("Dragon Supabase client not initialized. Add DRAGON_SUPABASE_URL and DRAGON_SUPABASE_SERVICE_ROLE_KEY to .env");
  }
  return dragonSupabase;
}

// Initialize database tables
export async function initializeDatabase() {
  console.log("🔧 Checking database table...");
  const supabaseClient = getSupabase();

  // Test if the table exists by trying to select from it
  const { data, error } = await supabaseClient
    .from("current_working_samples")
    .select("id")
    .limit(1);

  if (error) {
    console.log(
      "⚠️  Table current_working_samples does not exist. Please create it manually in Supabase with this SQL:"
    );
    console.log(`
      CREATE TABLE current_working_samples (
        id SERIAL PRIMARY KEY,
        generated_image_url TEXT NOT NULL,
        reference_image_url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } else {
    console.log("✅ Current working samples table exists and is accessible");
  }

  // Check training samples table
  const { data: trainingData, error: trainingError } = await supabaseClient
    .from("training_samples")
    .select("id")
    .limit(1);

  if (trainingError) {
    console.log(
      "⚠️  Table training_samples does not exist. Please create it manually in Supabase with this SQL:"
    );
    console.log(`
      CREATE TABLE training_samples (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        product_type TEXT NOT NULL,
        uploaded_image_url TEXT NOT NULL,
        generated_image_url TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
  } else {
    console.log("✅ Training samples table exists and is accessible");
  }
}