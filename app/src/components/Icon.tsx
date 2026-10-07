import React from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import { GLYPHS, GlyphName } from '../utils/glyphs';

const FAMILY = 'MaterialIcons';

export function glyph(name: GlyphName): string {
  return String.fromCodePoint(parseInt(GLYPHS[name], 16));
}

export default function Icon({
  name, size = 24, color = '#000', style,
}: {
  name: GlyphName; size?: number; color?: string; style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  return (
    <Text
      accessible={false}
      style={[{ fontFamily: FAMILY, fontSize: size, color, lineHeight: size * 1.1 }, style]}
    >
      {glyph(name)}
    </Text>
  );
}
