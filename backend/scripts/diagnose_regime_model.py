import pandas as pd
import numpy as np

# Load the data
df = pd.read_csv('data/processed/final_data_with_gann.csv', index_col=0, parse_dates=True)

print("="*60)
print("REGIME MODEL DIAGNOSTIC ANALYSIS")
print("="*60)

# Check regime distribution
print("\n1. REGIME CLASS DISTRIBUTION:")
print(df['Market_Regime'].value_counts())
print(f"\nPercentages:")
print(df['Market_Regime'].value_counts(normalize=True) * 100)

# Check for missing values
print(f"\n2. MISSING VALUES IN REGIME:")
print(f"Missing regime values: {df['Market_Regime'].isna().sum()}")

# Check regime over time
print(f"\n3. REGIME CHANGES OVER TIME:")
regime_changes = (df['Market_Regime'] != df['Market_Regime'].shift()).sum()
print(f"Total regime changes: {regime_changes}")
print(f"Average days per regime: {len(df) / regime_changes:.1f}")

# Check correlations with regime
print(f"\n4. TOP FEATURES CORRELATED WITH REGIME:")
df_clean = df.dropna(subset=['Market_Regime'])

# Get numeric columns only
numeric_cols = df_clean.select_dtypes(include=[np.number]).columns
correlations = df_clean[numeric_cols].corrwith(df_clean['Market_Regime']).abs().sort_values(ascending=False)

print("\nTop 20 correlated features:")
for feat, corr in correlations.head(20).items():
    if feat != 'Market_Regime':
        print(f"  {feat}: {corr:.4f}")

# Check Gann feature correlations
print(f"\n5. GANN FEATURE CORRELATIONS WITH REGIME:")
gann_features = [c for c in numeric_cols if 'Gann' in c or 'Lunar' in c or 'SQ9' in c or 'Retrograde' in c]
gann_corrs = correlations[correlations.index.isin(gann_features)].sort_values(ascending=False)

if len(gann_corrs) > 0:
    print("Gann features correlation:")
    for feat, corr in gann_corrs.head(10).items():
        print(f"  {feat}: {corr:.4f}")
else:
    print("No significant Gann correlations found")

# Check for data imbalance in train/test split
split_idx = int(len(df_clean) * 0.8)
train_regimes = df_clean.iloc[:split_idx]['Market_Regime']
test_regimes = df_clean.iloc[split_idx:]['Market_Regime']

print(f"\n6. TRAIN/TEST REGIME DISTRIBUTION:")
print("\nTrain set:")
print(train_regimes.value_counts())
print("\nTest set:")
print(test_regimes.value_counts())

print("\n7. POTENTIAL ISSUES:")
issues = []

# Issue 1: Class imbalance
regime_counts = df['Market_Regime'].value_counts()
if regime_counts.max() / regime_counts.min() > 3:
    issues.append("⚠️ SEVERE CLASS IMBALANCE - dominant class has 3x+ more samples")

# Issue 2: Low correlation
if correlations[correlations.index != 'Market_Regime'].max() < 0.3:
    issues.append("⚠️ LOW FEATURE CORRELATION - no features strongly predict regime")

# Issue 3: Temporal distribution
if test_regimes.value_counts().min() < 10:
    issues.append("⚠️ TEST SET HAS TOO FEW SAMPLES for some regimes")

if len(issues) > 0:
    for issue in issues:
        print(f"  {issue}")
else:
    print("  No obvious issues detected")

print("\n" + "="*60)
