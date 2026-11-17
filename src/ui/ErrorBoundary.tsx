import React from 'react';
import { Text, View } from 'react-native';
import { Button } from './components';
import { colors, space, type } from './theme';

interface State {
  error: Error | null;
}

/** Last line of defense: a render error shows a recoverable screen instead of closing the app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space(6), justifyContent: 'center' }}>
        <Text style={type.h1}>Something went wrong</Text>
        <Text style={[type.body, { marginTop: space(3) }]}>
          This screen hit an unexpected problem. Your history is safe. If you were watching, screen capture keeps running
          until you stop it from the notification.
        </Text>
        <Button label="Try again" size="lg" onPress={() => this.setState({ error: null })} style={{ marginTop: space(8) }} />
      </View>
    );
  }
}
