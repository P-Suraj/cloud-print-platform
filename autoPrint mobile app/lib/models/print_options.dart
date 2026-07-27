class PrintOptions {
  final int copies;
  final String colorMode; // 'bw' or 'color'
  final bool duplex;
  final String paperSize; // 'A4', 'A3', 'Letter', 'Legal'
  final String? pageRange;

  const PrintOptions({
    this.copies = 1,
    this.colorMode = 'bw',
    this.duplex = false,
    this.paperSize = 'A4',
    this.pageRange,
  });

  PrintOptions copyWith({
    int? copies,
    String? colorMode,
    bool? duplex,
    String? paperSize,
    String? pageRange,
  }) {
    return PrintOptions(
      copies: copies ?? this.copies,
      colorMode: colorMode ?? this.colorMode,
      duplex: duplex ?? this.duplex,
      paperSize: paperSize ?? this.paperSize,
      pageRange: pageRange ?? this.pageRange,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'copies': copies,
      'color_mode': colorMode,
      'duplex': duplex,
      'paper_size': paperSize,
      'page_range': pageRange,
    };
  }

  factory PrintOptions.fromJson(Map<String, dynamic> json) {
    return PrintOptions(
      copies: json['copies'] as int? ?? 1,
      colorMode: json['color_mode'] as String? ?? 'bw',
      duplex: json['duplex'] as bool? ?? false,
      paperSize: json['paper_size'] as String? ?? 'A4',
      pageRange: json['page_range'] as String?,
    );
  }
}
