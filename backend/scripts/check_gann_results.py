import pandas as pd

# Load enhanced dataset
df = pd.read_csv('data/processed/final_data_with_gann.csv', index_col=0, parse_dates=True)

print("="*60)
print("GANN-ENHANCED DATASET ANALYSIS")
print("="*60)

print(f"\nDataset Shape: {df.shape}")
print(f"Date Range: {df.index[0]} to {df.index[-1]}")

# Find Gann features
gann_cols = [c for c in df.columns if 'Gann' in c or 'Lunar' in c or 'SQ9' in c or 'Swing' in c or 'Retrograde' in c]
print(f"\nTotal Gann Features Added: {len(gann_cols)}")
print("\nGann Feature List:")
for col in sorted(gann_cols):
    print(f"  - {col}")

# Latest signals
latest = df.iloc[-1]
print("\n" + "="*60)
print("LATEST GANN SIGNALS")
print("="*60)
print(f"Date: {df.index[-1]}")
print(f"Close Price: ${latest['Close']:.2f}")

print("\n📐 GANN ANGLE SIGNALS:")
if 'Gann_Above_1x1' in latest:
    if latest['Gann_Above_1x1'] == 1:
        print("  ✅ Price ABOVE 1x1 angle - BULLISH TREND")
    else:
        print("  ⚠️  Price BELOW 1x1 angle - BEARISH TREND")

if 'Gann_Distance_1x1_Bull' in latest:
    print(f"  Distance from 1x1: {latest['Gann_Distance_1x1_Bull']:+.2f}%")

print("\n🌙 LUNAR PHASE:")
if 'Lunar_Volatility_Index' in latest:
    print(f"  Volatility Index: {latest['Lunar_Volatility_Index']:.3f}")
    print(f"  Bullish Bias: {latest.get('Lunar_Bullish_Bias', 0):.3f}")
    print(f"  Energy Level: {latest.get('Lunar_Energy_Level', 0):.3f}")

print("\n🔄 RETROGRADE STATUS:")
if 'Total_Retrogrades' in latest:
    print(f"  Active Retrogrades: {int(latest['Total_Retrogrades'])}")
    print(f"  Retrograde Volatility: {latest.get('Retrograde_Volatility', 0):.3f}")

print("\n" + "="*60)
print("✅ Gann integration successful!")
print("="*60)
