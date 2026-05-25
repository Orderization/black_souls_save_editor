# frozen_string_literal: true

require 'json'
require 'fileutils'
require 'time'

# Minimal RGSS class shims. These preserve raw binary payloads for RGSS custom
# serializable objects such as Table/Color/Tone when Marshal.dump writes the
# save back.
class Table
  def self._load(s)
    o = allocate
    o.instance_variable_set(:@__raw_rgss_dump, s)
    o
  end

  def _dump(_level)
    @__raw_rgss_dump || ''.b
  end
end

class Color
  def self._load(s)
    o = allocate
    o.instance_variable_set(:@__raw_rgss_dump, s)
    o
  end

  def _dump(_level)
    @__raw_rgss_dump || ''.b
  end
end

class Tone
  def self._load(s)
    o = allocate
    o.instance_variable_set(:@__raw_rgss_dump, s)
    o
  end

  def _dump(_level)
    @__raw_rgss_dump || ''.b
  end
end

def define_missing_constant(path)
  parts = path.split('::').reject(&:empty?)
  parent = Object
  parts.each_with_index do |part, idx|
    sym = part.to_sym
    if parent.const_defined?(sym, false)
      parent = parent.const_get(sym, false)
      next
    end
    obj = idx == parts.length - 1 ? Class.new : Module.new
    parent.const_set(sym, obj)
    parent = obj
  end
end

def constant_get_path(path)
  path.split('::').reject(&:empty?).inject(Object) do |parent, part|
    parent.const_get(part.to_sym, false)
  end
end

# Some VX Ace/RGSS classes serialize through marshal_dump/marshal_load.
# Outside the game engine those classes do not exist, so we preserve the
# marshaled payload verbatim and restore it when saving. This is mainly needed
# for classes such as Game_Interpreter in some VX Ace saves.
def install_generic_marshal_load(klass)
  unless klass.method_defined?(:marshal_load)
    klass.define_method(:marshal_load) do |payload|
      @__generic_marshal_payload = payload
      if payload.is_a?(Hash)
        payload.each do |k, v|
          begin
            name = k.to_s
            name = "@#{name}" unless name.start_with?('@')
            instance_variable_set(name.to_sym, v)
          rescue StandardError
            # Keep payload even if a key cannot be mapped to an instance variable.
          end
        end
      end
      payload
    end
  end

  unless klass.method_defined?(:marshal_dump)
    klass.define_method(:marshal_dump) do
      @__generic_marshal_payload || begin
        instance_variables.each_with_object({}) do |ivar, h|
          next if ivar == :@__generic_marshal_payload
          h[ivar] = instance_variable_get(ivar)
        end
      end
    end
  end
end

def load_marshal_from_io(io)
  start_pos = io.pos
  attempts = 0
  begin
    Marshal.load(io)
  rescue ArgumentError, TypeError => e
    attempts += 1
    raise e if attempts > 1000

    # Marshal.load consumes bytes before reporting an unknown class/module.
    # Reset and retry after defining the missing constant.
    io.pos = start_pos if io.respond_to?(:pos=)

    msg = e.message
    if msg =~ /undefined class\/module ([A-Za-z0-9_:]+)/
      define_missing_constant(Regexp.last_match(1))
      retry
    elsif msg =~ /class ([A-Za-z0-9_:]+) needs to have method `_load'/
      klass_name = Regexp.last_match(1)
      define_missing_constant(klass_name)
      klass = constant_get_path(klass_name)
      unless klass.respond_to?(:_load)
        klass.define_singleton_method(:_load) do |payload|
          o = allocate
          o.instance_variable_set(:@__raw_rgss_dump, payload)
          o
        end
      end
      unless klass.method_defined?(:_dump)
        klass.define_method(:_dump) do |_level|
          @__raw_rgss_dump || ''.b
        end
      end
      retry
    elsif msg =~ /instance of ([A-Za-z0-9_:]+) needs to have method [`']marshal_load'/
      klass_name = Regexp.last_match(1)
      define_missing_constant(klass_name)
      klass = constant_get_path(klass_name)
      install_generic_marshal_load(klass)
      retry
    else
      raise e
    end
  end
end

def load_marshal_objects(path)
  objects = []
  File.open(path, 'rb') do |file|
    until file.eof?
      objects << load_marshal_from_io(file)
    end
  end
  objects
end

def load_marshal_file(path)
  # Database .rvdata2 files contain one Marshal object.
  # Save*.rvdata2 files normally contain two Marshal objects: header, then contents.
  # For database loading, return the first object only.
  load_marshal_objects(path).first
end

def save_contents_score(obj)
  return -1 unless obj.respond_to?(:[])

  score = 0
  score += 100 if key_get(obj, :party)
  score += 50 if key_get(obj, :actors)
  score += 20 if key_get(obj, :variables)
  score += 20 if key_get(obj, :switches)
  score += 5 if key_get(obj, :player)
  score += 5 if key_get(obj, :map)
  score
end

def load_save_file(path)
  objects = load_marshal_objects(path)
  raise 'empty Marshal file' if objects.empty?

  # VX Ace saves are usually: Marshal.dump(header), Marshal.dump(contents).
  # The old version loaded only the first object, so it was accidentally reading
  # the header instead of actual editable save contents.
  scored = objects.each_with_index.map { |obj, idx| [save_contents_score(obj), idx, obj] }
  best_score, best_idx, best_obj = scored.max_by { |score, idx, _obj| [score, idx] }
  if best_score <= 0
    # Fallback: single-object save or nonstandard custom save.
    best_idx = objects.length - 1
    best_obj = objects[best_idx]
  end

  {
    objects: objects,
    contents_index: best_idx,
    contents: best_obj
  }
end

def write_save_file(path, loaded_save)
  objects = loaded_save[:objects]
  idx = loaded_save[:contents_index]
  contents = loaded_save[:contents]

  objects[idx] = contents
  File.open(path, 'wb') do |file|
    objects.each { |obj| Marshal.dump(obj, file) }
  end
end

def key_get(hash, key)
  return nil unless hash.respond_to?(:[])

  hash[key] || hash[key.to_s] || hash[key.to_sym]
end

def iv(obj, name)
  return nil if obj.nil?

  obj.instance_variable_get(name)
rescue StandardError
  nil
end

def set_iv(obj, name, value)
  return nil if obj.nil?

  obj.instance_variable_set(name, value)
end

def array_data(obj)
  data = iv(obj, :@data)
  data.is_a?(Array) ? data : []
end

def safe_scalar(v)
  case v
  when nil, true, false, Numeric, String
    v
  when Symbol
    v.to_s
  else
    v.inspect
  end
end

def parse_scalar(s)
  return nil if s.nil?
  return s unless s.is_a?(String)

  t = s.strip
  return nil if t == '' || t == 'nil' || t == 'null'
  return true if t == 'true'
  return false if t == 'false'
  return t.to_i if t =~ /\A[-+]?\d+\z/
  return t.to_f if t =~ /\A[-+]?(\d+\.\d*|\d*\.\d+)([eE][-+]?\d+)?\z/ || t =~ /\A[-+]?\d+[eE][-+]?\d+\z/

  begin
    parsed = JSON.parse(t)
    return parsed if [NilClass, TrueClass, FalseClass, Integer, Float, String].any? { |c| parsed.is_a?(c) }
  rescue StandardError
    # keep original string
  end
  s
end

def load_db_array(db_dir, filename)
  return [] if db_dir.nil? || db_dir == ''

  path = File.join(db_dir, filename)
  return [] unless File.file?(path)

  obj = load_marshal_file(path)
  obj.respond_to?(:to_a) ? obj.to_a : []
rescue StandardError
  []
end

def db_names(db_dir, filename)
  names = {}
  load_db_array(db_dir, filename).each_with_index do |obj, idx|
    next if obj.nil?

    id = iv(obj, :@id) || idx
    name = iv(obj, :@name)
    names[id.to_i] = name.to_s unless name.nil? || name.to_s.empty?
  end
  names
end

def system_names(db_dir)
  result = { variables: {}, switches: {} }
  return result if db_dir.nil? || db_dir == ''

  path = File.join(db_dir, 'System.rvdata2')
  return result unless File.file?(path)

  sys = load_marshal_file(path)
  variables = iv(sys, :@variables)
  switches = iv(sys, :@switches)
  if variables.is_a?(Array)
    variables.each_with_index do |name, idx|
      next if idx.zero? || name.nil? || name.to_s.empty?

      result[:variables][idx] = name.to_s
    end
  end
  if switches.is_a?(Array)
    switches.each_with_index do |name, idx|
      next if idx.zero? || name.nil? || name.to_s.empty?

      result[:switches][idx] = name.to_s
    end
  end
  result
rescue StandardError
  result
end

def database_summary(db_dir)
  sys = system_names(db_dir)
  {
    ok: true,
    db_dir: db_dir,
    variables: sys[:variables],
    switches: sys[:switches],
    actors: db_names(db_dir, 'Actors.rvdata2'),
    items: db_names(db_dir, 'Items.rvdata2'),
    weapons: db_names(db_dir, 'Weapons.rvdata2'),
    armors: db_names(db_dir, 'Armors.rvdata2')
  }
end

def contents_part(contents, key)
  key_get(contents, key)
end

def party(contents)
  contents_part(contents, :party)
end

def variables_obj(contents)
  contents_part(contents, :variables)
end

def switches_obj(contents)
  contents_part(contents, :switches)
end

def actors_obj(contents)
  contents_part(contents, :actors)
end

def count_for_id(h, id)
  return 0 unless h.is_a?(Hash)

  h[id] || h[id.to_s] || h[id.to_sym] || 0
end

def inventory_entries_with_names(h, names, show_all = true)
  ids = []
  ids.concat(names.keys.map(&:to_i)) if show_all
  ids.concat(h.keys.map(&:to_i)) if h.is_a?(Hash)
  ids.uniq.sort.map do |id|
    count = count_for_id(h, id).to_i
    next if !show_all && count <= 0

    { id: id, name: names[id] || '', count: count }
  end.compact
end

def actor_entries(contents, actor_names)
  obj = actors_obj(contents)
  data = array_data(obj)
  out = []
  data.each_with_index do |actor, idx|
    next if actor.nil?

    id = (iv(actor, :@actor_id) || idx).to_i
    out << {
      id: id,
      name: (iv(actor, :@name) || actor_names[id] || '').to_s,
      level: safe_scalar(iv(actor, :@level)),
      hp: safe_scalar(iv(actor, :@hp)),
      mp: safe_scalar(iv(actor, :@mp))
    }
  end
  out
end

def variable_entries(contents, variable_names, show_all = false)
  vars = array_data(variables_obj(contents))
  max_id = [vars.length - 1, variable_names.keys.map(&:to_i).max || 0].max
  out = []
  (1..max_id).each do |i|
    v = vars[i]
    next if !show_all && (v.nil? || v == 0 || v == false || v == '') && !variable_names.key?(i)

    out << {
      id: i,
      name: variable_names[i] || '',
      value: safe_scalar(v),
      type: v.nil? ? 'NilClass' : v.class.to_s
    }
  end
  out
end

def switch_entries(contents, switch_names, show_all = false)
  sws = array_data(switches_obj(contents))
  max_id = [sws.length - 1, switch_names.keys.map(&:to_i).max || 0].max
  out = []
  (1..max_id).each do |i|
    v = !!sws[i]
    next if !show_all && !v && !switch_names.key?(i)

    out << {
      id: i,
      name: switch_names[i] || '',
      value: v
    }
  end
  out
end

def object_key_names(obj)
  return [] unless obj.respond_to?(:keys)

  obj.keys.map { |k| k.respond_to?(:to_s) ? k.to_s : k.inspect }
rescue StandardError
  []
end

def summary(save_path, db_dir)
  loaded = load_save_file(save_path)
  contents = loaded[:contents]
  pty = party(contents)

  sys = system_names(db_dir)
  item_names = db_names(db_dir, 'Items.rvdata2')
  weapon_names = db_names(db_dir, 'Weapons.rvdata2')
  armor_names = db_names(db_dir, 'Armors.rvdata2')
  actor_names = db_names(db_dir, 'Actors.rvdata2')

  {
    ok: true,
    save_path: save_path,
    db_dir: db_dir,
    marshal_object_count: loaded[:objects].length,
    contents_index: loaded[:contents_index],
    contents_keys: object_key_names(contents),
    gold: safe_scalar(iv(pty, :@gold)),
    variables: variable_entries(contents, sys[:variables], true),
    switches: switch_entries(contents, sys[:switches], true),
    items: inventory_entries_with_names(iv(pty, :@items), item_names, true),
    weapons: inventory_entries_with_names(iv(pty, :@weapons), weapon_names, true),
    armors: inventory_entries_with_names(iv(pty, :@armors), armor_names, true),
    actors: actor_entries(contents, actor_names)
  }
end

def ensure_array_slot(arr, index)
  arr << nil while arr.length <= index
end

def apply_patch(save_path, patch_path)
  loaded = load_save_file(save_path)
  contents = loaded[:contents]
  patch = JSON.parse(File.read(patch_path))

  pty = party(contents)
  if pty && patch.key?('gold')
    set_iv(pty, :@gold, patch['gold'].to_i)
  end

  var_obj = variables_obj(contents)
  var_data = array_data(var_obj)
  if patch['variables'].is_a?(Array)
    patch['variables'].each do |row|
      id = row['id'].to_i
      next if id <= 0

      ensure_array_slot(var_data, id)
      var_data[id] = parse_scalar(row['value'].to_s)
    end
    set_iv(var_obj, :@data, var_data) if var_obj
  end

  sw_obj = switches_obj(contents)
  sw_data = array_data(sw_obj)
  if patch['switches'].is_a?(Array)
    patch['switches'].each do |row|
      id = row['id'].to_i
      next if id <= 0

      ensure_array_slot(sw_data, id)
      sw_data[id] = !!row['value']
    end
    set_iv(sw_obj, :@data, sw_data) if sw_obj
  end

  if pty
    {
      'items' => :@items,
      'weapons' => :@weapons,
      'armors' => :@armors
    }.each do |patch_key, ivar|
      next unless patch[patch_key].is_a?(Array)

      h = iv(pty, ivar)
      h = {} unless h.is_a?(Hash)
      patch[patch_key].each do |row|
        id = row['id'].to_i
        count = row['count'].to_i
        next if id <= 0

        if count <= 0
          h.delete(id)
          h.delete(id.to_s)
        else
          h[id] = count
        end
      end
      set_iv(pty, ivar, h)
    end
  end

  act_obj = actors_obj(contents)
  act_data = array_data(act_obj)
  if patch['actors'].is_a?(Array)
    patch['actors'].each do |row|
      id = row['id'].to_i
      next if id <= 0 || id >= act_data.length

      actor = act_data[id]
      next if actor.nil?

      set_iv(actor, :@level, row['level'].to_i) if row.key?('level') && row['level'].to_s.strip != ''
      set_iv(actor, :@hp, row['hp'].to_i) if row.key?('hp') && row['hp'].to_s.strip != ''
      set_iv(actor, :@mp, row['mp'].to_i) if row.key?('mp') && row['mp'].to_s.strip != ''
    end
    set_iv(act_obj, :@data, act_data) if act_obj
  end

  backup_path = save_path + '.bak-' + Time.now.strftime('%Y%m%d-%H%M%S')
  FileUtils.cp(save_path, backup_path)
  write_save_file(save_path, loaded)
  { ok: true, backup: backup_path, marshal_object_count: loaded[:objects].length, contents_index: loaded[:contents_index] }
end

begin
  op = ARGV[0]
  result = case op
           when 'database'
             database_summary(ARGV[1])
           when 'summary'
             raise 'missing save path' if ARGV[1].nil?

             summary(ARGV[1], ARGV[2])
           when 'apply'
             raise 'missing save path or patch path' if ARGV[1].nil? || ARGV[2].nil?

             apply_patch(ARGV[1], ARGV[2])
           else
             raise "unknown op: #{op.inspect}"
           end
  puts JSON.generate(result)
rescue StandardError => e
  warn e.full_message
  puts JSON.generate({ ok: false, error: e.message })
  exit 1
end
