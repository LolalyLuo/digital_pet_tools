#!/usr/bin/env python3
import os
from supabase import create_client, Client

# Set environment variables
os.environ['SUPABASE_URL'] = 'https://njxpguzxsodxtrbkxusz.supabase.co'
os.environ['SUPABASE_SERVICE_ROLE_KEY'] = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qeHBndXp4c29keHRyYmt4dXN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzU2OTQ1NywiZXhwIjoyMDczMTQ1NDU3fQ.dM01I07kRotVmh3kaZ3Oe76VxcLtx6PLanbJ8PasUv4'

supabase_url = os.environ.get('SUPABASE_URL')
supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')

supabase: Client = create_client(supabase_url, supabase_key)

print("Checking what data sets are available...")
response = supabase.table('training_samples').select('data_set_name').execute()

if response.data:
    data_sets = set()
    for row in response.data:
        data_sets.add(row.get('data_set_name'))

    print(f"Found {len(response.data)} total samples")
    print(f"Available data sets: {list(data_sets)}")

    # Get count for each data set
    for dataset in data_sets:
        count_response = supabase.table('training_samples').select('id', count='exact').eq('data_set_name', dataset).execute()
        print(f"  {dataset}: {count_response.count} samples")

else:
    print("No training samples found at all")

# Test getting samples for first available data set
if response.data:
    first_dataset = list(data_sets)[0] if data_sets else None
    if first_dataset:
        print(f"\nTesting with data set: {first_dataset}")
        from main import get_training_samples_from_supabase
        samples = get_training_samples_from_supabase(first_dataset)
        print(f"Successfully retrieved {len(samples)} samples")
        if samples:
            sample = samples[0]
            print(f"Sample keys: {list(sample.keys())}")
            print(f"First sample: ID={sample.get('id')}, uploaded_image_url={sample.get('uploaded_image_url')[:50] if sample.get('uploaded_image_url') else None}...")