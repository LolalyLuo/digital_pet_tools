-- Only 2 tables needed
CREATE TABLE uploaded_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id UUID REFERENCES uploaded_photos(id),
  initial_prompt TEXT NOT NULL,
  generated_prompt TEXT NOT NULL,
  image_url TEXT NOT NULL,
  number SERIAL,
  size TEXT CHECK (size IN ('auto', '1024×1024', '1024×1536', '1536×1024')),
  background TEXT CHECK (background IN ('opaque', 'transparent', 'auto')),
  model TEXT CHECK (model IN ('openai', 'gemini', 'gemini-img2img')) DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);