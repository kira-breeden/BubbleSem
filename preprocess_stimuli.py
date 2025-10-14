"""
Preprocess stimuli CSV files by adding target_word_position column.
This script finds the position of the target word in each passage.
"""

import pandas as pd
import sys
import re


def find_target_word_position(passage, target_word):
    """
    Find the position (index) of the target word in the passage.
    
    Parameters:
    - passage: the full passage/sentence as a string
    - target_word: the target word to find
    
    Returns:
    - The word index (0-based) of the target word, or -1 if not found
    """
    if pd.isna(passage) or pd.isna(target_word):
        return -1
    
    # Split passage into words (space-separated)
    words = passage.split()
    
    # Clean the target word (remove punctuation for comparison)
    clean_target = target_word.lower().strip()
    clean_target = re.sub(r'[.,!?;:\'"]+$', '', clean_target)
    
    # Search for the target word
    for i, word in enumerate(words):
        # Clean each word for comparison
        clean_word = word.lower().strip()
        clean_word = re.sub(r'[.,!?;:\'"]+$', '', clean_word)
        
        if clean_word == clean_target:
            return i
    
    # If not found, print warning
    print(f"WARNING: Could not find target word '{target_word}' in passage: {passage[:50]}...")
    return -1


def preprocess_stimuli(input_csv, output_csv=None):
    """
    Add target_word_position column to stimuli CSV.
    
    Parameters:
    - input_csv: path to input CSV file
    - output_csv: path to output CSV file (if None, overwrites input)
    """
    print(f"\nProcessing: {input_csv}")
    print("=" * 70)
    
    # Load the CSV
    df = pd.read_csv(input_csv)
    print(f"Loaded {len(df)} rows")
    
    # Check for required columns
    required_cols = ['target_word']
    passage_cols = ['passage_variant', 'jabber_passage']
    
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"Required column '{col}' not found in CSV")
    
    # Find which passage column to use
    passage_col = None
    for col in passage_cols:
        if col in df.columns:
            passage_col = col
            break
    
    if passage_col is None:
        raise ValueError(f"No passage column found. Expected one of: {passage_cols}")
    
    print(f"Using passage column: '{passage_col}'")
    
    # Add target_word_position column
    print("\nFinding target word positions...")
    df['target_word_position'] = df.apply(
        lambda row: find_target_word_position(row[passage_col], row['target_word']),
        axis=1
    )
    
    # Report statistics
    num_found = (df['target_word_position'] >= 0).sum()
    num_not_found = (df['target_word_position'] == -1).sum()
    
    print(f"\nResults:")
    print(f"  ✓ Found: {num_found} / {len(df)}")
    if num_not_found > 0:
        print(f"  ✗ Not found: {num_not_found}")
        print("\nRows where target was not found:")
        not_found_df = df[df['target_word_position'] == -1][['target_word', passage_col]]
        print(not_found_df.to_string(index=True))
    
    # Show position distribution
    if num_found > 0:
        print(f"\nTarget word position statistics:")
        print(f"  Min position: {df['target_word_position'].min()}")
        print(f"  Max position: {df['target_word_position'].max()}")
        print(f"  Mean position: {df['target_word_position'].mean():.2f}")
    
    # Save the processed file
    if output_csv is None:
        output_csv = input_csv
    
    df.to_csv(output_csv, index=False)
    print(f"\n✓ Saved processed file: {output_csv}")
    
    return df


def process_all_sublists(prefix='trial_list_sublist'):
    """
    Process all sublist files (1-4) and the main stimuli file.
    """
    print("\n" + "=" * 70)
    print("PREPROCESSING ALL STIMULI FILES")
    print("=" * 70)
    
    files_to_process = [
        'final_pilot_stimuli.csv',
        f'{prefix}_1.csv',
        f'{prefix}_2.csv',
        f'{prefix}_3.csv',
        f'{prefix}_4.csv'
    ]
    
    processed_count = 0
    for filename in files_to_process:
        try:
            preprocess_stimuli(filename)
            processed_count += 1
        except FileNotFoundError:
            print(f"\nSkipping {filename} (file not found)")
        except Exception as e:
            print(f"\nError processing {filename}: {e}")
    
    print("\n" + "=" * 70)
    print(f"✓ Successfully processed {processed_count} file(s)")
    print("=" * 70)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        # Process specific file
        input_file = sys.argv[1]
        output_file = sys.argv[2] if len(sys.argv) > 2 else None
        preprocess_stimuli(input_file, output_file)
    else:
        # Process all standard files
        process_all_sublists()
