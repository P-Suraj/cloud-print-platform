class AppConstants {
  // Supabase Configuration
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://dqlllduhjexxysrbyaau.supabase.co', // Default matching project config
  );

  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxbGxsZHVoamV4eHlzcmJ5YWF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjIwMDY1MDAsImV4cCI6MjAzNzU4MjUwMH0.placeholder',
  );

  static const String storageBucket = 'print-files';

  // Supported File MIME Types
  static const List<String> supportedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  // Helper for human-readable unsupported messages
  static String getUnsupportedMessage(String mimeType) {
    if (mimeType.contains('powerpoint') || mimeType.contains('presentation')) {
      return "PowerPoint files aren't supported yet.\nExport as PDF from PowerPoint: File → Export → PDF";
    }
    if (mimeType.contains('excel') || mimeType.contains('spreadsheet')) {
      return "Excel files aren't supported.\nExport as PDF: File → Export → PDF";
    }
    if (mimeType.contains('text/plain')) {
      return "Plain text files aren't supported.\nOpen in Docs and export as PDF.";
    }
    return "This file type isn't supported.\nPlease share a PDF or image instead.";
  }
}
