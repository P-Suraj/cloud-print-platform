import 'package:flutter/material.dart';
import '../models/shop.dart';
import '../models/print_options.dart';

class OptionsBottomSheet extends StatefulWidget {
  final Shop shop;
  final int fileCount;
  final Function(PrintOptions) onConfirm;

  const OptionsBottomSheet({
    super.key,
    required this.shop,
    required this.fileCount,
    required this.onConfirm,
  });

  @override
  State<OptionsBottomSheet> createState() => _OptionsBottomSheetState();
}

class _OptionsBottomSheetState extends State<OptionsBottomSheet> {
  int _copies = 1;
  String _colorMode = 'bw'; // 'bw' or 'color'
  bool _duplex = false;
  String _paperSize = 'A4';
  final TextEditingController _pageRangeController = TextEditingController();

  String? _calculateEstimatedCost() {
    final slabs = _colorMode == 'color' ? widget.shop.colorSlabs : widget.shop.bwSlabs;
    if (slabs.isEmpty) return null; // Hide estimated price if shop hasn't set rate slabs

    double rate = _colorMode == 'color' ? (_duplex ? 9.0 : 10.0) : (_duplex ? 1.8 : 2.0);
    // Find matching slab
    for (final s in slabs) {
      if (s is Map) {
        final minVal = s['min'] as int? ?? 1;
        final maxVal = s['max'] as int?;
        if (_copies >= minVal && (maxVal == null || _copies <= maxVal)) {
          final matchedRate = (_duplex && s['duplex_rate'] != null)
              ? (s['duplex_rate'] as num).toDouble()
              : (s['rate'] as num?)?.toDouble();
          if (matchedRate != null) {
            rate = matchedRate;
          }
          break;
        }
      }
    }
    final total = (_copies * rate * widget.fileCount);
    return total.toStringAsFixed(2);
  }

  @override
  void dispose() {
    _pageRangeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final estimatedPrice = _calculateEstimatedCost();

    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      decoration: const BoxDecoration(
        color: Color(0xFF14141B),
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFF374151),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Print Options',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                widget.shop.name,
                style: const TextStyle(
                  color: Color(0xFF6366F1),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          if (widget.fileCount > 1) ...[
            const SizedBox(height: 4),
            Text(
              'Options apply to all ${widget.fileCount} files',
              style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
            ),
          ],
          const SizedBox(height: 20),

          // 1. Copies
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Copies', style: TextStyle(color: Colors.white, fontSize: 14)),
              Row(
                children: [
                  IconButton(
                    onPressed: _copies > 1 ? () => setState(() => _copies--) : null,
                    icon: const Icon(Icons.remove_circle_outline, color: Colors.white),
                  ),
                  Container(
                    width: 36,
                    alignment: Alignment.center,
                    child: Text(
                      '$_copies',
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                  ),
                  IconButton(
                    onPressed: _copies < 99 ? () => setState(() => _copies++) : null,
                    icon: const Icon(Icons.add_circle_outline, color: Colors.white),
                  ),
                ],
              ),
            ],
          ),
          const Divider(color: Color(0xFF2A2A36), height: 24),

          // 2. Color Mode
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Color Mode', style: TextStyle(color: Colors.white, fontSize: 14)),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'bw', label: Text('Black & White')),
                  ButtonSegment(value: 'color', label: Text('Color')),
                ],
                selected: {_colorMode},
                onSelectionChanged: (set) => setState(() => _colorMode = set.first),
                style: SegmentedButton.styleFrom(
                  backgroundColor: const Color(0xFF1A1A22),
                  selectedBackgroundColor: const Color(0xFF6366F1),
                  selectedForegroundColor: Colors.white,
                  foregroundColor: const Color(0xFF9CA3AF),
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFF2A2A36), height: 24),

          // 3. Sides (Duplex)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Sides', style: TextStyle(color: Colors.white, fontSize: 14)),
              SegmentedButton<bool>(
                segments: const [
                  ButtonSegment(value: false, label: Text('Single-Sided')),
                  ButtonSegment(value: true, label: Text('Double-Sided')),
                ],
                selected: {_duplex},
                onSelectionChanged: (set) => setState(() => _duplex = set.first),
                style: SegmentedButton.styleFrom(
                  backgroundColor: const Color(0xFF1A1A22),
                  selectedBackgroundColor: const Color(0xFF6366F1),
                  selectedForegroundColor: Colors.white,
                  foregroundColor: const Color(0xFF9CA3AF),
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFF2A2A36), height: 24),

          // 4. Paper Size
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Paper Size', style: TextStyle(color: Colors.white, fontSize: 14)),
              DropdownButton<String>(
                value: _paperSize,
                dropdownColor: const Color(0xFF1A1A22),
                underline: const SizedBox.shrink(),
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                items: ['A4', 'A3', 'Letter', 'Legal'].map((s) {
                  return DropdownMenuItem(value: s, child: Text(s));
                }).toList(),
                onChanged: (val) {
                  if (val != null) setState(() => _paperSize = val);
                },
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Estimated Price Footer (if rates available)
          if (estimatedPrice != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A22),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Estimated Price', style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
                  Text(
                    '₹ $estimatedPrice',
                    style: const TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Submit Button
          ElevatedButton(
            onPressed: () {
              final options = PrintOptions(
                copies: _copies,
                colorMode: _colorMode,
                duplex: _duplex,
                paperSize: _paperSize,
                pageRange: _pageRangeController.text.trim().isEmpty ? null : _pageRangeController.text.trim(),
              );
              Navigator.pop(context);
              widget.onConfirm(options);
            },
            child: const Text('Upload & Print →'),
          ),
        ],
      ),
    );
  }
}
