-- Core tables
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
  similar_examples TEXT,
  number SERIAL,
  size TEXT CHECK (size IN ('auto', '1024×1024', '1024×1536', '1536×1024')),
  background TEXT CHECK (background IN ('opaque', 'transparent', 'auto')),
  model TEXT CHECK (model IN ('openai', 'gemini', 'gemini-img2img', 'seedream')) DEFAULT NULL,
  model_config JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Iteration system tables
CREATE TABLE photo_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  photo_ids UUID[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE iteration_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  evaluation_criteria JSONB NOT NULL,
  source_photo_bundles TEXT[] NOT NULL,
  generation_method JSONB NOT NULL,
  idea_generation_method JSONB NOT NULL,
  iteration_settings JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE iteration_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id UUID REFERENCES iteration_configs(id),
  status TEXT CHECK (status IN ('running', 'paused', 'completed', 'failed')) DEFAULT 'running',
  current_iteration INTEGER DEFAULT 0,
  total_iterations INTEGER NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
);

CREATE TABLE iteration_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES iteration_runs(id),
  iteration_number INTEGER NOT NULL,
  generated_image_id UUID REFERENCES generated_images(id),
  evaluation_score DECIMAL,
  evaluation_details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);