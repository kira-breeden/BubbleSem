import pandas as pd
import numpy as np

def generate_four_sublists(input_csv, output_prefix='trial_list_sublist', 
                          seed_column=None, entropy_column='entropy',
                          min_variants_required=4):
    """
    Generate four counterbalanced sub-lists from trial data.
    Within each seed passage, variants are sorted by entropy, then rotated across sublists.
    
    Parameters:
    - input_csv: path to your main trial list CSV
    - output_prefix: prefix for output CSV files
    - seed_column: column name that identifies different seed passages (auto-detected if None)
    - entropy_column: column name containing entropy values
    - min_variants_required: minimum variants per seed to include (default: 4 for 4 sublists)
    """
    
    # Load the trial data
    df = pd.read_csv(input_csv)
    
    print(f"Loaded {len(df)} rows from {input_csv}")
    print(f"Columns: {df.columns.tolist()}\n")
    
    # Auto-detect seed column if not specified
    if seed_column is None:
        # Try common column names in order of preference
        potential_cols = ['passage_seed_num', 'og_passage_seed_number', 'seed_number', 
                         'seed_id', 'passage_id']
        for col in potential_cols:
            if col in df.columns:
                seed_column = col
                print(f"Auto-detected seed column: '{seed_column}'")
                break
        
        if seed_column is None:
            raise ValueError(f"Cannot find seed column. Available columns: {df.columns.tolist()}")
    
    # Verify columns exist
    if seed_column not in df.columns:
        raise ValueError(f"Seed column '{seed_column}' not found in CSV")
    
    if entropy_column not in df.columns:
        print(f"Warning: '{entropy_column}' column not found. Cannot sort by entropy.")
        df[entropy_column] = 0
    
    # Group by seed and count variants
    variants_per_seed = df.groupby(seed_column).size()
    print(f"\nFound {len(variants_per_seed)} unique seed passages")
    print(f"Variants per seed (distribution):")
    print(variants_per_seed.value_counts().sort_index())
    
    # Filter to seeds with enough variants
    seeds_with_enough_variants = variants_per_seed[variants_per_seed >= min_variants_required].index
    
    if len(seeds_with_enough_variants) == 0:
        print(f"\n❌ ERROR: No seeds have {min_variants_required}+ variants!")
        print(f"Maximum variants found: {variants_per_seed.max()}")
        return None
    
    if len(seeds_with_enough_variants) < len(variants_per_seed):
        excluded = len(variants_per_seed) - len(seeds_with_enough_variants)
        print(f"\n⚠️  Excluding {excluded} seeds with fewer than {min_variants_required} variants")
    
    # Filter dataframe to only include seeds with enough variants
    df_filtered = df[df[seed_column].isin(seeds_with_enough_variants)].copy()
    print(f"\nUsing {len(df_filtered)} rows from {len(seeds_with_enough_variants)} seeds")
    
    # Sort by seed and entropy within each seed
    df_sorted = df_filtered.sort_values([seed_column, entropy_column]).reset_index(drop=True)
    
    print(f"\nEntropy range: {df_sorted[entropy_column].min():.4f} to {df_sorted[entropy_column].max():.4f}")
    
    # Create four sub-lists by rotating through entropy-sorted variants
    sublists = []
    
    for sublist_num in range(1, 5):
        sublist_trials = []
        
        print(f"\n{'='*70}")
        print(f"Creating Sublist {sublist_num}")
        print(f"{'='*70}")
        
        # For each seed passage
        for seed_val in df_sorted[seed_column].unique():
            seed_variants = df_sorted[df_sorted[seed_column] == seed_val].copy()
            
            # Calculate which variant this sublist should get
            # Rotate through variants (0, 1, 2, 3, 0, 1, 2, 3, ...)
            num_variants = len(seed_variants)
            variant_index = (sublist_num - 1) % num_variants
            
            # Select the variant at this index (already sorted by entropy)
            selected_variant = seed_variants.iloc[variant_index:variant_index+1].copy()
            
            # Show what we selected
            entropy_val = selected_variant[entropy_column].values[0] if entropy_column in selected_variant.columns else 'N/A'
            target = selected_variant['target_word'].values[0] if 'target_word' in selected_variant.columns else 'N/A'
            print(f"  Seed {seed_val}: Selected variant {variant_index+1}/{num_variants} "
                  f"(entropy={entropy_val:.4f}, target='{target}')")
            
            sublist_trials.append(selected_variant)
        
        # Combine all selected variants for this sublist
        sublist_df = pd.concat(sublist_trials, ignore_index=True)
        
        # Add sublist identifier
        sublist_df['sublist'] = sublist_num
        
        # Update trial numbers to be sequential
        sublist_df['trial_number'] = range(1, len(sublist_df) + 1)
        
        sublists.append(sublist_df)
        
        # Save to CSV
        output_filename = f'{output_prefix}_{sublist_num}.csv'
        sublist_df.to_csv(output_filename, index=False)
        print(f"\n✓ Saved {output_filename} with {len(sublist_df)} trials")
        
        # Show entropy statistics
        if entropy_column in sublist_df.columns:
            print(f"  Entropy: min={sublist_df[entropy_column].min():.4f}, "
                  f"max={sublist_df[entropy_column].max():.4f}, "
                  f"mean={sublist_df[entropy_column].mean():.4f}")
    
    # Create a detailed summary file
    print(f"\n{'='*70}")
    print("Creating Summary Files")
    print(f"{'='*70}")
    
    summary_data = []
    for i, sublist in enumerate(sublists, 1):
        for seed_val in sorted(sublist[seed_column].unique()):
            seed_trial = sublist[sublist[seed_column] == seed_val].iloc[0]
            summary_data.append({
                'sublist': i,
                'seed': seed_val,
                'entropy': seed_trial.get(entropy_column, 'N/A'),
                'target_word': seed_trial.get('target_word', 'N/A'),
                'trial_number': seed_trial.get('trial_number', 'N/A')
            })
    
    summary_df = pd.DataFrame(summary_data)
    summary_file = f'{output_prefix}_summary.csv'
    summary_df.to_csv(summary_file, index=False)
    print(f"\n✓ Saved {summary_file}")
    
    # Create pivot table showing counterbalancing
    print(f"\n{'='*70}")
    print("COUNTERBALANCING VERIFICATION")
    print(f"{'='*70}")
    
    pivot = summary_df.pivot(index='seed', columns='sublist', values='entropy')
    print("\nEntropy values by seed and sublist:")
    print(pivot.to_string())
    
    print("\n✓ Each row = one seed passage")
    print("✓ Each column = one sublist")
    print("✓ Values = entropy of the variant assigned to that sublist for that seed")
    print("✓ Notice how sublist 1 has lowest entropy, sublist 4 has highest entropy\n")
    
    return sublists

# Example usage
if __name__ == '__main__':
    import sys
    
    # Get filename from command line or prompt
    if len(sys.argv) > 1:
        csv_file = sys.argv[1]
    else:
        csv_file = input("Enter CSV filename: ")
    
    # Generate sublists
    print("\n" + "="*70)
    print("GENERATING FOUR SUBLISTS")
    print("="*70 + "\n")
    
    sublists = generate_four_sublists(csv_file)
    
    if sublists:
        print("\n" + "="*70)
        print("✓ SUCCESS! Generated 4 sublists:")
        print("="*70)
        print("  - trial_list_sublist_1.csv")
        print("  - trial_list_sublist_2.csv")
        print("  - trial_list_sublist_3.csv")
        print("  - trial_list_sublist_4.csv")
        print("  - trial_list_sublist_summary.csv")
        print("\nYou can now upload these files and use them with the experiment!\n")