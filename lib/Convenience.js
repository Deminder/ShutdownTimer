/**
    AUTHOR: Daniel Neumann
**/
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;

const Config = imports.misc.config;

let debugMode = false;

function logDebug(...args) {
  if (debugMode) {
    log(...args);
  }
}

/**
 * initTranslations:
 * @domain: (optional): the gettext domain to use
 *
 * Initialize Gettext to load translations from extensionsdir/locale.
 * If @domain is not provided, it will be taken from metadata['gettext-domain']
 */
function initTranslations(domain) {
  domain = domain || Me.metadata["gettext-domain"];

  // check if this extension was built with "make zip-file", and thus
  // has the locale files in a subfolder
  // otherwise assume that extension has been installed in the
  // same prefix as gnome-shell
  let localeDir = Me.dir.get_child("locale");
  if (localeDir.query_exists(null))
    Gettext.bindtextdomain(domain, localeDir.get_path());
  else Gettext.bindtextdomain(domain, Config.LOCALEDIR);
  Gettext.textdomain(domain);
}

/**
 * getSettings:
 * @schema: (optional): the GSettings schema id
 *
 * Builds and return a GSettings schema for @schema, using schema files
 * in extensionsdir/schemas. If @schema is not provided, it is taken from
 * metadata['settings-schema'].
 */
function getSettings(schema) {
  schema = schema || Me.metadata["settings-schema"];

  const GioSSS = Gio.SettingsSchemaSource;

  // check if this extension was built with "make zip-file", and thus
  // has the schema files in a subfolder
  // otherwise assume that extension has been installed in the
  // same prefix as gnome-shell (and therefore schemas are available
  // in the standard folders)
  let schemaDir = Me.dir.get_child("schemas");
  let schemaSource;
  if (schemaDir.query_exists(null))
    schemaSource = GioSSS.new_from_directory(
      schemaDir.get_path(),
      GioSSS.get_default(),
      false
    );
  else schemaSource = GioSSS.get_default();

  let schemaObj = schemaSource.lookup(schema, true);
  if (!schemaObj)
    throw new Error(
      "Schema " +
        schema +
        " could not be found for extension " +
        Me.metadata.uuid +
        ". Please check your installation."
    );

  return new Gio.Settings({ settings_schema: schemaObj });
}
