# Dog Art Style Batch Testing App - Setup Guide

## Environment Variables

Create a `.env` file in the root directory with:

```bash
# Supabase Configuration
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

# OpenAI API Key (for Edge Functions)
OPENAI_API_KEY=your_openai_api_key

# Supabase Service Role Key (for Edge Functions)
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Database Setup

Run these SQL commands in your Supabase SQL editor:

```sql
-- Create tables
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('uploaded-photos', 'uploaded-photos', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('generated-images', 'generated-images', true);

-- Set up storage policies
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'uploaded-photos');
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'generated-images');
CREATE POLICY "Authenticated users can upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'uploaded-photos' AND auth.role() = 'authenticated');
```

## Edge Functions Setup

1. Deploy the Edge Functions:
```bash
supabase functions deploy generate-prompts
supabase functions deploy generate-images
```

2. Set environment variables for Edge Functions:
```bash
supabase secrets set OPENAI_API_KEY=your_openai_api_key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Running the App

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

## Features

- **Left Panel**: Upload and select dog photos
- **Middle Panel**: Generate and edit art style prompts
- **Right Panel**: View and download generated images organized by prompt

## Workflow

1. Upload dog photos (drag & drop)
2. Select photos to use
3. Enter initial art style prompt
4. Generate prompt variations using AI
5. Edit prompts if needed
6. Generate images using DALL-E
7. View results organized by prompt
8. Download individual images
